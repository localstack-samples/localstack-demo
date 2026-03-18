# Async Request Processing with Lambda and Step Functions using LocalStack

| Key          | Value                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Environment  | LocalStack, AWS                                                                                              |
| Services     | Lambda, DynamoDB, SQS, Step Functions, API Gateway, S3                                                      |
| Integrations | AWS CDK, AWS CLI, Docker, LocalStack                                                                         |
| Categories   | Serverless, Compute                                                                                          |
| Level        | Intermediate                                                                                                 |
| Use Case     | Asynchronous Request Processing                                                                              |
| GitHub       | [Repository link](https://github.com/localstack/localstack-demo)                                            |

## Introduction

This sample demonstrates a typical web application scenario where requests are accepted by a REST API and processed asynchronously in the background — all running locally inside LocalStack. The infrastructure is defined with AWS CDK and uses three different Lambda runtimes (Node.js, Python, and Ruby) to showcase a polyglot serverless architecture.

When a user creates a new request via the frontend, it travels through SQS, a Step Functions state machine, and two Python Lambda functions before the result is written to S3. The frontend polls the API to display live status transitions (`QUEUED → PROCESSING → FINISHED`).

## Architecture

The following diagram shows the architecture that this sample application builds and deploys:

![Architecture](./demo/web/architecture.png)

- **API Gateway (REST)** — exposes `POST /requests` and `GET /requests` endpoints backed by a Node.js Lambda function.
- **[SQS](https://docs.localstack.cloud/user-guide/aws/sqs/)** — decouples the HTTP handler from the processing pipeline; the Node.js Lambda enqueues each new request.
- **[Lambda](https://docs.localstack.cloud/user-guide/aws/lambda/)** — three runtimes in play:
  - **Node.js** (`httpHandleRequest`) — handles HTTP requests, writes initial status to DynamoDB, enqueues to SQS.
  - **Ruby** (`sqsHandleItem`) — consumes SQS messages and triggers the Step Functions execution.
  - **Python** (`backendProcessRequest`, `backendArchiveResult`) — processes and archives results.
- **[Step Functions](https://docs.localstack.cloud/user-guide/aws/stepfunctions/)** — orchestrates the two-step processing pipeline.
- **[DynamoDB](https://docs.localstack.cloud/user-guide/aws/dynamodb/)** — stores request status at every stage.
- **[S3](https://docs.localstack.cloud/user-guide/aws/s3/)** — stores the final result file and serves the React frontend.

## Prerequisites

- A valid [LocalStack for AWS license](https://localstack.cloud/pricing). Your license provides a [`LOCALSTACK_AUTH_TOKEN`](https://docs.localstack.cloud/getting-started/auth-token/) to activate LocalStack.
- [`localstack` CLI](https://docs.localstack.cloud/getting-started/installation/#localstack-cli).
- [AWS CLI](https://docs.localstack.cloud/user-guide/integrations/aws-cli/) with the [`awslocal` wrapper](https://docs.localstack.cloud/user-guide/integrations/aws-cli/#localstack-aws-cli-awslocal).
- [CDK](https://docs.localstack.cloud/user-guide/integrations/aws-cdk/) with the [`cdklocal`](https://www.npmjs.com/package/aws-cdk-local) wrapper (installed automatically via `cdk/package.json`).
- [Node.js 22+](https://nodejs.org/en/download/)
- [Docker](https://docs.docker.com/get-docker/) — required to bundle Ruby Lambda gems.
- [`jq`](https://jqlang.github.io/jq/download/)
- [`make`](https://www.gnu.org/software/make/)

## Installation

Clone the repository:

```bash
git clone https://github.com/localstack/localstack-demo.git
cd localstack-demo
```

Install the CDK project dependencies:

```bash
make install
```

## Deployment

Set your LocalStack auth token and start LocalStack:

```bash
export LOCALSTACK_AUTH_TOKEN=<your-auth-token>
make start
make ready
```

Deploy the full stack (bundles Lambda dependencies, bootstraps CDK, deploys, uploads frontend):

```bash
make deploy
```

The output will be similar to the following:

```
LocalstackDemoStack: deploying... [1/1]
...
 ✅  LocalstackDemoStack

Outputs:
LocalstackDemoStack.ApiEndpoint = https://<api-id>.execute-api.localhost.localstack.cloud:4566/local/
LocalstackDemoStack.WebsiteUrl  = http://localhost:4566/archive-bucket/index.html

Done! Open http://localhost:4566/archive-bucket/index.html in your browser.
```

## Testing

### Browser UI

Open the frontend in your browser:

```
http://localhost:4566/archive-bucket/index.html
```

![Demo Application](./demo/web/demo.png)

- Enable **Auto-Refresh** to continuously poll for new results.
- Click **Create new request** to send a new request to the backend API.
- Watch the request move through `QUEUED → PROCESSING → FINISHED` in the table.
- When the status is `FINISHED`, a **Download result** link appears pointing to the result file in S3.

### CLI smoke test

To send a request from the terminal and poll S3 until the result appears:

```bash
make send-request
```

The output will be similar to the following:

```
Looking up REST API ID...
Sending request to API ID 'lgbmikdf4o' ...
Received request ID 'e5503b47'
Polling s3://archive-bucket/ for result ...
                           PRE e5503b47/
```

You can also browse the contents of the archive bucket directly:

```bash
awslocal s3 ls s3://archive-bucket/
```

## Summary

This sample application demonstrates how to build and test a polyglot serverless pipeline using AWS CDK and LocalStack:

- Defining AWS infrastructure (API Gateway, Lambda, SQS, Step Functions, DynamoDB, S3) entirely with **AWS CDK in TypeScript**.
- Running **three Lambda runtimes** (Node.js, Python, Ruby) side-by-side in the same CDK stack.
- Serving a **React frontend from S3** that auto-discovers the API Gateway endpoint and polls for status updates.
- Using `cdklocal` and `awslocal` to streamline **local deployment and testing** without touching real AWS.
- Providing a **GitHub Actions workflow** that runs the full integration test suite on every push.

## Learn More

- [LocalStack Lambda documentation](https://docs.localstack.cloud/user-guide/aws/lambda/)
- [LocalStack Step Functions documentation](https://docs.localstack.cloud/user-guide/aws/stepfunctions/)
- [Deploying AWS CDK applications with LocalStack](https://docs.localstack.cloud/user-guide/integrations/aws-cdk/)
- [AWS CDK documentation](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
