import datetime
import os
import time
import uuid

import boto3

# boto3 automatically picks up AWS_ENDPOINT_URL from the environment (boto3 >= 1.28)
DYNAMODB_TABLE = os.environ.get('TABLE_NAME') or 'appRequests'
S3_BUCKET = os.environ.get('ARCHIVE_BUCKET') or 'archive-bucket'


def handle_request(event, context=None):
    # simulate queueing delay
    time.sleep(5)
    print('handle_request', event)
    set_status(event['requestID'], 'PROCESSING')
    # simulate processing delay
    time.sleep(4)
    return {
        'requestID': event['requestID'],
        'status': 'PROCESSING',
    }


def archive_result(event, context=None):
    print('archive_result', event)
    requestID = event['requestID']
    s3 = boto3.client('s3')
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=f'{requestID}/result.txt',
        Body=f'Archive result for request {requestID}',
    )
    # simulate archive delay
    time.sleep(3)
    set_status(requestID, 'FINISHED')


def set_status(requestID, status):
    dynamodb = boto3.client('dynamodb')
    dynamodb.put_item(
        TableName=DYNAMODB_TABLE,
        Item={
            'id': {'S': short_uid()},
            'requestID': {'S': requestID},
            'timestamp': {'N': str(now_utc())},
            'status': {'S': status},
        },
    )


def now_utc():
    diff = datetime.datetime.utcnow() - datetime.datetime(1970, 1, 1)
    return int(diff.total_seconds() * 1000.0)


def short_uid():
    return str(uuid.uuid4())[0:8]
