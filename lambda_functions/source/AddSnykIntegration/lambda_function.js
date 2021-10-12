// @TODO - Axios likely isn't necessary, it's simply convenient -
//         migrate to https.request maybe.
const axios = require('axios');

// The CloudFormation template provides a number of inputs which
// are passed to the Lambda as environment variables. Set them
// to variables to avoid typing process.env all the time.
const orgID = process.env.orgId;
const awsRegion = process.env.awsRegion;
const awsRoleArn = process.env.awsRoleArn;

// Entrypoint function
//
// The handler is the function within the Lambda Function that runs
// when the Lambda is invoked. In the CloudFormation template(s) this
// is specified in the Properties section of AddSnykIntegrationLambdaFunction.
exports.handler = (event, context) => {
  // Only act on Create.
  if (event.RequestType === 'Create') {
    try {
      // Construct the Snyk API request URL.
      const snykAPI = `https://snyk.io/api/v1/org/${orgID}/integrations`;
      console.log('snykAPI: ', snykAPI);

      // Make the request
      // @see https://snyk.docs.apiary.io/#reference/integrations/integrations/add-new-integration
      //
      // - Likely no reason to use async here, this is the only thing
      //   we're doing on Create.
      //
      // @TODO: Switch this to post once ready to make the request.
      //
      axios.get(snykAPI, {
        timeout: 10000,
        headers: {
          'Authorization': `token ${orgID}` // This should supposedly work, but usually is an API token.
        },
        data: {
          type: 'ecr',
          credentials: {
            region: awsRegion,
            roleArn: awsRoleArn
          }
        }
      }).then( response => {
        console.log('Response Type: ', typeof (response));
        console.log('Response: ', response);
        sendResponse(event, context, 'SUCCESS', response.data);
      }).catch( error => {
        console.log('Error in Snyk request: ', error);
        sendResponse(event, context, 'FAILED', error);
      });
    } catch(e) {
      console.log('Error during API call:\n', e);
      sendResponse(event, context, 'FAILED', response.data);
    }
  } else {
    sendResponse(event, context, 'SUCCESS', {});
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

  console.log('Response Body:\n', responseBody);

  const https = require('https');
  const url = require('url')
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
    console.log('STATUS: ', response.statusCode);
    console.log('HEADERS: ', JSON.stringify(response.headers));
    // Tell Lambda the function is done.
    context.done();
  });

  request.on('error', (error) => {
    console.log('sendResponse Error: ', error);
    context.done();
  });

  // Write data to request body.
  request.write(responseBody);
  request.end();

}
