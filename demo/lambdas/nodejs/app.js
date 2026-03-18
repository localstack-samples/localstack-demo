'use strict';

const { DynamoDBClient, PutItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { SQSClient, GetQueueUrlCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { randomUUID } = require('crypto');

// AWS SDK v3 automatically picks up AWS_ENDPOINT_URL from the environment
const dynamoClient = new DynamoDBClient({});
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME || 'appRequests';
const QUEUE_URL = process.env.QUEUE_URL;
const QUEUE_NAME = process.env.QUEUE_NAME || 'requestQueue';

const shortUid = () => randomUUID().substring(0, 8);

const headers = {
  'content-type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
};

const handleRequest = async (event) => {
  const reqPath = event.path || event.rawPath || '';
  const method =
    event.httpMethod ||
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    '';

  if (reqPath.endsWith('/requests') && method === 'POST') {
    return startNewRequest();
  } else if (reqPath.endsWith('/requests') && method === 'GET') {
    return listRequests();
  }
  return { statusCode: 404, headers, body: JSON.stringify({}) };
};

const startNewRequest = async () => {
  const requestID = shortUid();

  // Resolve queue URL — prefer the injected env var, fall back to lookup
  let queueUrl = QUEUE_URL;
  if (!queueUrl) {
    const res = await sqsClient.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
    queueUrl = res.QueueUrl;
  }

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ requestID }),
    }),
  );

  await dynamoClient.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        id: { S: shortUid() },
        requestID: { S: requestID },
        timestamp: { N: String(Date.now()) },
        status: { S: 'QUEUED' },
      },
    }),
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ requestID, status: 'QUEUED' }),
  };
};

const listRequests = async () => {
  const result = await dynamoClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  const items = (result.Items || []).map((item) => {
    const obj = {};
    for (const [key, val] of Object.entries(item)) {
      if (val.N !== undefined) obj[key] = parseFloat(val.N);
      else if (val.S !== undefined) obj[key] = val.S;
      else obj[key] = Object.values(val)[0];
    }
    return obj;
  });
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ result: items }),
  };
};

module.exports = { handleRequest };
