"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalstackDemoStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const sfn = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const tasks = __importStar(require("aws-cdk-lib/aws-stepfunctions-tasks"));
const lambdaEventSources = __importStar(require("aws-cdk-lib/aws-lambda-event-sources"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const path = __importStar(require("path"));
class LocalstackDemoStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        sqsHandlerLambda.addEventSource(new lambdaEventSources.SqsEventSource(queue, { batchSize: 1 }));
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
exports.LocalstackDemoStack = LocalstackDemoStack;
