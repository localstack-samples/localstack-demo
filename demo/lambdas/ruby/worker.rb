require 'bundler/setup'
require 'aws-sdk-states'

$state_machine_arn = ENV['STATE_MACHINE_ARN']
$aws_endpoint_url  = ENV['AWS_ENDPOINT_URL']

def triggerProcessing(event:, context:)
  client_opts = {}
  client_opts[:endpoint] = $aws_endpoint_url if $aws_endpoint_url

  client = Aws::States::Client.new(**client_opts)

  event['Records'].each do |rec|
    client.start_execution(
      state_machine_arn: $state_machine_arn,
      input: rec['body'],
    )
  end

  {}
end
