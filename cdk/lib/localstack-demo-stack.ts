import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class LocalstackDemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── DynamoDB ──────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'AppRequests', {
      tableName: 'appRequests',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'requestID', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── SQS Queue ─────────────────────────────────────────────────────────
    const queue = new sqs.Queue(this, 'RequestQueue', {
      queueName: 'requestQueue',
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    // ── S3 Archive Bucket ─────────────────────────────────────────────────
    const archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
      bucketName: 'archive-bucket',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
    });

    // ── Python Lambdas (3.13) ─────────────────────────────────────────────
    const processingLambda = new lambda.Function(this, 'BackendProcessRequest', {
      functionName: 'backendProcessRequest',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'processing.handle_request',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../demo/lambdas/python')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });
    table.grantWriteData(processingLambda);

    const archiveLambda = new lambda.Function(this, 'BackendArchiveResult', {
      functionName: 'backendArchiveResult',
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'processing.archive_result',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../demo/lambdas/python')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ARCHIVE_BUCKET: archiveBucket.bucketName,
      },
    });
    table.grantWriteData(archiveLambda);
    archiveBucket.grantWrite(archiveLambda);

    // ── Step Functions State Machine ──────────────────────────────────────
    const processTask = new tasks.LambdaInvoke(this, 'ProcessRequest', {
      lambdaFunction: processingLambda,
      outputPath: '$.Payload',
    });

    const archiveTask = new tasks.LambdaInvoke(this, 'ArchiveResult', {
      lambdaFunction: archiveLambda,
      outputPath: '$.Payload',
    });

    const stateMachine = new sfn.StateMachine(this, 'ProcessingStateMachine', {
      stateMachineName: 'processingStateMachine',
      definitionBody: sfn.DefinitionBody.fromChainable(processTask.next(archiveTask)),
      timeout: cdk.Duration.minutes(5),
    });

    // ── Ruby Lambda 3.3 (SQS handler) ─────────────────────────────────────
    const sqsHandlerLambda = new lambda.Function(this, 'SqsHandleItem', {
      functionName: 'sqsHandleItem',
      runtime: lambda.Runtime.RUBY_3_3,
      handler: 'worker.triggerProcessing',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../demo/lambdas/ruby')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
    });
    stateMachine.grantStartExecution(sqsHandlerLambda);
    queue.grantConsumeMessages(sqsHandlerLambda);
    sqsHandlerLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(queue, { batchSize: 1 }),
    );

    // ── Node.js Lambda 22.x (HTTP handler) ───────────────────────────────
    const httpHandlerLambda = new lambda.Function(this, 'HttpHandleRequest', {
      functionName: 'httpHandleRequest',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'app.handleRequest',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../demo/lambdas/nodejs')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        QUEUE_URL: queue.queueUrl,
      },
    });
    table.grantReadWriteData(httpHandlerLambda);
    queue.grantSendMessages(httpHandlerLambda);

    // ── REST API Gateway (stage=local to match frontend discovery) ────────
    const api = new apigateway.RestApi(this, 'LocalstackDemoApi', {
      restApiName: 'localstack-demo',
      deployOptions: { stageName: 'local' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
      },
    });

    const requests = api.root.addResource('requests');
    const integration = new apigateway.LambdaIntegration(httpHandlerLambda);
    requests.addMethod('POST', integration);
    requests.addMethod('GET', integration);

    // ── Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'REST API Gateway endpoint URL',
    });
    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: 'http://localhost:4566/archive-bucket/index.html',
      description: 'Frontend URL — open this in your browser after deploy',
    });
  }
}
