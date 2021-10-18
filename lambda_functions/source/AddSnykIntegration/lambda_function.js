// import https from 'https';
const https = require('https');
const url = require('url')
const request = require('request');

// Inputs:
//  - The CloudFormation template provides a number of inputs which
//    are passed to the Lambda as environment variables. Set them
//    to variables to avoid typing process.env all the time.
const groupId = process.env.groupId;
const sourceOrgId = process.env.orgId;
const authToken = process.env.authToken;
const orgPatternPrefix = process.env.orgPatternPrefix;
const awsRegion = process.env.awsRegion;
const awsRoleArn = process.env.awsRoleArn;

// Set up some messages:
const messages = {
  integrationCreated: 'Successfully created ECR integration for Snyk organization %s',
  problemCreatingIntegration: 'A problem occurred while attempting to create an ECR integration in Snyk for organization %s.',
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

  let creationStatus = 'FAILED';
  let creationData = { message: 'no data' };

  // Only act on Create.
  if (event.RequestType === 'Create') {
    try {

      // Outline:
      // - First Generate a name we'll use for a new org.
      // - @TODO: We optionally take a SOURCE ORG ID to generate a new Org.
      // - Next, query the Snyk API to create a new organization.
      // - Collect the returned ID of the org from the last query
      // - Make a second request to create the integration in the new Org.
      //   Since the org is new there's no need to check for existing integrations.

      // Generate a new Organization name.
      const newOrgNameRand = Math.random().toString(36).slice(2)
      const newOrgName = `${orgPatternPrefix}-${newOrgNameRand}`;

      console.log('New Org being created: ', newOrgName);


      // Create the new Organization in Snyk via the Snyk API.
      request({
        method: 'POST',
        url: `https://snyk.io/api/v1/org`,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `token ${authToken}`
        },
        body: JSON.stringify({
          name: newOrgName,
          groupId: groupId,
          sourceOrgId: sourceOrgId
        })
      }, (error, response, body) => {
        console.log('create new org - Response Status: ', response.statusCode);
        console.log('create new org - Headers: ', JSON.stringify(response.headers));
        console.log('create new org - Response:', body);

        if (error) {
          console.log('Error received when sending POST to Snyk API', error);
          sendResponse(event, context, 'FAILED', error);
        }

        // Successfully created the new Organization.
        if (response.statusCode === 201) {

          const newOrg = JSON.parse(body);
          const newOrgId = newOrg.id;

          console.log('body before integration', body);



          console.log(`Requesting new integration creation at: https://snyk.io/api/v1/org/${newOrgId}/integrations`);

          // Now that we have an org we need to send a request for creating
          // an integration, using the new org's ID.
          request({
            method: 'POST',
            url: `https://snyk.io/api/v1/org/${newOrgId}/integrations`,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Authorization': `token ${authToken}`
            },
            body: "{  \"type\": \"ecr\",  \"credentials\": {    \"region\": \"" + awsRegion + "\",    \"roleArn\": \"" + awsRoleArn + "\"  }}"
          }, (error, response, body) => {

            console.log('create new integration - Response Status: ', response.statusCode);
            console.log('create new integration - Headers: ', JSON.stringify(response.headers));
            console.log('create new integration - Response:', body);

            if (!error && (response.statusCode === 200 || response.statusCode === 201)) {
              console.log(messages.integrationCreated);
              creationStatus = 'SUCCESS';
              creationData = JSON.parse(body);
              // sendResponse(event, context, 'SUCCESS', JSON.parse(body));
            } else {
              console.log('Problem creating new Integration for Org: ', newOrgId);
              if (error) {
                console.log('The error encountered was: ', error);
              }
              creationStatus = 'FAILED';
              creationData = JSON.parse(body);
              // sendResponse(event, context, 'FAILED', error !== null ? { message: error } : { message: JSON.parse(body) });
            }
          });
        } else {
          // Else we didn't get a 201 when trying to create the org
          // sendResponse(event, context, 'FAILED', body);
          creationStatus = 'FAILED';
          creationData = JSON.parse(body);
        }
      });


    } catch (e) {
      console.log('Error during API call:\n', e);
      // sendResponse(event, context, 'FAILED', { message: e });
      creationStatus = 'FAILED';
      creationData = { message: e };
    }
  } else {
    // If CloudFormation isn't sending this function a Create event, succeed with
    // a note saying the integration creation has been skipped.
    // It may be a good idea to remove the integration that exists on a tear-down event.
    // sendResponse(event, context, 'SUCCESS', { message: messages.notCreateEvent });
    creationStatus = 'SUCCESS';
    creationData = { message: messages.notCreateEvent };
  }



  // Once everything is finished, send the response.
  sendResponse(event, context, creationStatus, creationData);

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
