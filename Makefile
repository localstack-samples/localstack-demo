SHELL := /bin/bash

-include .env-gdc-local

CDIR = cd cdk

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_DEFAULT_REGION    ?= us-east-1
export AWS_ENDPOINT_URL      ?= http://localhost.localstack.cloud:4566

usage:            ## Show this help in table format
	@echo "| Target                 | Description                                                       |"
	@echo "|------------------------|-------------------------------------------------------------------|"
	@fgrep -h "##" $(MAKEFILE_LIST) | fgrep -v fgrep | sed -e 's/:.*##\s*/##/g' | awk -F'##' '{ printf "| %-22s | %-65s |\n", $$1, $$2 }'

check:            ## Check if all required prerequisites are installed
	@command -v docker > /dev/null 2>&1 || { echo "Docker is not installed. Please install Docker and try again."; exit 1; }
	@command -v node > /dev/null 2>&1 || { echo "Node.js is not installed. Please install Node.js and try again."; exit 1; }
	@command -v aws > /dev/null 2>&1 || { echo "AWS CLI is not installed. Please install AWS CLI and try again."; exit 1; }
	@command -v lstk > /dev/null 2>&1 || { echo "lstk is not installed. Run: npm install -g @localstack/lstk"; exit 1; }
	@command -v cdk > /dev/null 2>&1 || { echo "AWS CDK CLI is not installed. Run: npm install -g aws-cdk"; exit 1; }
	@command -v jq > /dev/null 2>&1 || { echo "jq is not installed. See https://jqlang.github.io/jq/download/"; exit 1; }
	@test -n "$(LOCALSTACK_AUTH_TOKEN)" || { echo "LOCALSTACK_AUTH_TOKEN is not set. Find your token at https://app.localstack.cloud/workspace/auth-token"; exit 1; }
	@echo "All required prerequisites are available."

install:          ## Install CDK and Lambda dependencies
	@$(CDIR); if [ ! -d "node_modules" ]; then \
		echo "Installing CDK dependencies..."; \
		npm install; \
	else \
		echo "CDK dependencies already installed."; \
	fi

bundle-ruby:      ## Bundle Ruby 3.3 Lambda gems (requires Docker)
	docker run --rm \
		-v "$(shell pwd)/demo/lambdas/ruby:/var/task" \
		-w /var/task \
		ruby:3.3 \
		sh -c "bundle config set --local path vendor/bundle && bundle install"

bundle-node:      ## Install Node.js Lambda production dependencies
	cd demo/lambdas/nodejs && npm install --omit=dev

build:            ## Build the CDK TypeScript app
	$(CDIR) && npm run build

bootstrap:        ## Bootstrap CDK for LocalStack
	$(CDIR) && npm run build && lstk cdk bootstrap

deploy:           ## Build, deploy CDK stack to LocalStack, and upload frontend
	$(MAKE) bundle-ruby bundle-node
	$(MAKE) bootstrap
	$(CDIR) && lstk cdk deploy LocalstackDemoStack --require-approval never
	@echo "Uploading frontend to s3://archive-bucket/ ..."
	lstk aws s3 sync demo/web/ s3://archive-bucket/
	@echo ""
	@echo "Done! Open http://localhost:4566/archive-bucket/index.html in your browser."

destroy:          ## Destroy the deployed CDK stack on LocalStack
	$(CDIR) && lstk cdk destroy LocalstackDemoStack

send-request:     ## Send a test request and poll S3 for the result
	@command -v jq > /dev/null 2>&1 || { echo "jq is not installed. See https://jqlang.github.io/jq/download/"; exit 1; }
	@echo "Looking up REST API ID..."
	@apiId=$$(lstk aws apigateway get-rest-apis --output json | jq -r '.items[] | select(.name=="localstack-demo") | .id'); \
		echo "Sending request to API ID '$$apiId' ..."; \
		reqID=$$(curl -s -d '{}' "http://localhost:4566/_aws/execute-api/$$apiId/local/requests" | jq -r .requestID); \
		echo "Received request ID '$$reqID'"; \
		for i in 1 2 3 4 5 6 7 8 9 10; do \
			echo "Polling s3://archive-bucket/ for result ..."; \
			lstk aws s3 ls s3://archive-bucket/ | grep "$$reqID" && exit 0; \
			sleep 3; \
		done; \
		echo "Timed out waiting for result."

start:            ## Start LocalStack
	@echo "Starting LocalStack..."
	@test -n "$(LOCALSTACK_AUTH_TOKEN)" || { echo "LOCALSTACK_AUTH_TOKEN is not set. Find your token at https://app.localstack.cloud/workspace/auth-token"; exit 1; }
	@unset AWS_ENDPOINT_URL; LOCALSTACK_AUTH_TOKEN=$(LOCALSTACK_AUTH_TOKEN) lstk start
	@echo "LocalStack started successfully."

stop:             ## Stop LocalStack
	@echo "Stopping LocalStack..."
	@unset AWS_ENDPOINT_URL; lstk stop
	@echo "LocalStack stopped successfully."

logs:             ## Save LocalStack logs to logs.txt
	@unset AWS_ENDPOINT_URL; lstk logs > logs.txt

PKG_SUB_DIRS := $(dir $(shell find . -type d -name node_modules -prune -o -type d -name "vendor" -prune -o -type f -name package.json -print))

update-deps:      ## Update npm dependencies in all sub-projects
	for i in $(PKG_SUB_DIRS); do \
		pushd $$i && ncu -u && npm install && popd; \
	done

.PHONY: usage check install bundle-ruby bundle-node build bootstrap deploy deploy-aws \
        destroy destroy-aws send-request start stop logs update-deps
