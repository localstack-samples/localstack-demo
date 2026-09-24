#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LocalstackDemoStack } from '../lib/localstack-demo-stack';

const app = new cdk.App();
const localstackDemoStack = new LocalstackDemoStack(app, 'LocalstackDemoStack');
cdk.Tags.of(localstackDemoStack).add('aws-apn-id', 'pc:9yq38ki5jw5mas7jhjthpgveo');
