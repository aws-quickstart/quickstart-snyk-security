const https = require('https');
const url = require('url')
const request = require('request');

// The CloudFormation template provides a number of inputs which
// are passed to the Lambda as environment variables. Set them
// to variables to avoid typing process.env all the time.
const orgID = process.env.orgId;
const authToken = process.env.authToken;
const awsRegion = process.env.awsRegion;
const awsRoleArn = process.env.awsRoleArn;

// Set up some messages:
const messages = {
  integrationExists: `An existing ECR integration already exists for the provided Snyk organization: ${orgID}.`,
  integrationCreated: `Successfully created ECR integration for Snyk organization ${orgID}`,
  problemCreatingIntegration: `A problem occurred while attempting to create an ECR integration in Snyk for organization ${orgID}.`,
  APIGetError: 'Error during GET request to Snyk API.',
  APIPostError: 'Error during POST request to Snyk API.',
  notCreateEvent: 'Skipping Snyk integration creation... This is not a CloudFormation CREATE event.'
}

// Entrypoint function
//
// The handler is the function within the Lambda Function that runs
// when the Lambda is invoked. In the CloudFormation template(s) this
// is specified in the Properties section of AddSnykIntegrationLambdaFunction.
exports.handler = (event, context) => {
  // Only act on Create.
  if (event.RequestType === 'Create') {
    try {
      // First do a GET on the organization's integrations to see if there's an ECR
      // integration already, if there is, we need to skip.

      // request and axios are easier to chain off of than pure https, but it could be done.
      request({
        method: 'GET',
        url: `https://snyk.io/api/v1/org/${orgID}/integrations`,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `token ${authToken}`
        }
      }, (error, response, body) => {

        if (!error) {
          const data = response.body;
          let existingECRIntegration = false;

          if (data.ecr && data.ecr !== '') {
            existingECRIntegration = true;
          }

          // If there is no existing ECR Integration for this organization within Snyk,
          // it is safe to create one.
          if (existingECRIntegration === false) {
            request({
              method: 'POST',
              url: `https://snyk.io/api/v1/org/${orgID}/integrations`,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `token ${authToken}`
              },
              body: "{  \"type\": \"ecr\",  \"credentials\": {    \"region\": \"" + awsRegion + "\",    \"roleArn\": \"" + awsRoleArn + "\"  }}"
            }, (error, response, body) => {
              console.log('response status', response.statusCode);
              if (response.statusCode === 200 || response.statusCode === 201) {
                console.log(messages.integrationCreated);
                sendResponse(event, context, 'SUCCESS', JSON.parse(body));
              } else {
                let message;
                response.statusCode === 409 ? message = messages.integrationExists : message = messages.problemCreatingIntegration;
                sendResponse(event, context, 'FAILED', error !== null ? {message: error} : {message});
              }
            });
          } else {
            // The GET request returned an existing ECR integration with Snyk.
            // Tell CloudFormation we've failed.
            sendResponse(event, context, 'FAILED', {message: messages.integrationExists});
          }

        } else {
          // An error was received from the GET request. Shut it down.
          console.log(messages.APIGetError, error);
          sendResponse(event, context, 'FAILED', {message: error});
        }

      });


    } catch(e) {
      console.log('Error during API call:\n', e);
      sendResponse(event, context, 'FAILED', {message: e});
    }
  } else {
    // If CloudFormation isn't sending this function a Create event, succeed with
    // a note saying the integration creation has been skipped.
    // It may be a good idea to remove the integration that exists on a tear-down event.
    sendResponse(event, context, 'SUCCESS', {message: messages.notCreateEvent});
  }
}

// Send response to pre-signed URL
//
// The pre-signed URL is part of the `event` object that CloudFormation
// passes to the handler.
const sendResponse = (event, context, responseStatus, responseData) => {

  // Construct the response body that CF expects.
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData
  })

  console.log('Response Body to reply to CloudFormation:\n', responseBody);

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  };

  console.log('Sending response...\n');

  // Construct the request using the above option values.
  const request = https.request(options, (response) => {
    console.log('Response to CloudFormation - STATUS:\n', response.statusCode);
    console.log('Response to CloudFormation - HEADERS:\n', JSON.stringify(response.headers));
    // Tell Lambda the function is done.
    context.done();
  });

  request.on('error', (error) => {
    console.log('Response to CloudFormation - Error:\n', error);
    context.done();
  });

  // Write data to request body.
  request.write(responseBody);
  request.end();

}
