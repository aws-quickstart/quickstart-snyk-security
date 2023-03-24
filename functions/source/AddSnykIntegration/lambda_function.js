const axios = require('axios');
const cfnResponse = require('cfn-response-async');

// Inputs:
//  - The CloudFormation template provides a number of inputs which
//    are passed to the Lambda as environment variables. Set them
//    to variables to avoid typing process.env all the time.
const groupId = process.env.groupId;
const authToken = process.env.authToken;
const orgPatternPrefix = process.env.orgPatternPrefix;
const awsRegion = process.env.awsRegion;
const awsRoleArn = process.env.awsRoleArn;


// Define request headers for both the Org and Integration functions.
const requestHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Authorization': `token ${authToken}`
}

// Create a Snyk Organization.
// - Set up an Axios request to query the Snyk API and return a Promise.
// - Takes no parameters, but uses globally scoped variables.
const createSnykOrg = () => {
  // Generate a new Organization name.
  const newOrgNameRand = Math.random().toString(36).slice(2);
  const newOrgName = `${orgPatternPrefix}-${newOrgNameRand}`;
  console.log('New Org being created: ', newOrgName);

  // Set up the Request for creating a new Organization within Snyk.
  const newOrgRequestOptions = {
    method: 'post',
    url: 'https://snyk.io/api/v1/org',
    data: JSON.stringify({
      name: newOrgName,
      groupId: groupId,
    }),
    headers: requestHeaders
  }

  // Return a POST request to Snyk's API for creating a new
  // Organization as a Promise.
  return axios(newOrgRequestOptions)
    .then(response => {
      return response.data.id;
    })
    .then(finalResponse => {
      console.log(`createSnykOrg finished with the following output: ${finalResponse}\nReturning it...`);
      return finalResponse;
    })
    .catch(e => {
      console.log(`Encountered error creating Organization within Snyk: ${e}`);
      return { message: `Encountered error creating Organization within Snyk: ${e}` };
    });
}


// Use the Snyk API to install the integration with Amazon Elastic Container Registry (ECR)
// in the new organization that we created above.
// - Accepts an orgId as a string.
const createSnykIntegration = orgId => {

  const newECRIntegrationOptions = {
    method: 'post',
    url: `https://snyk.io/api/v1/org/${orgId}/integrations`,
    data: JSON.stringify({
      type: 'ecr',
      credentials: {
        region: awsRegion,
        roleArn: awsRoleArn
      }
    }),
    headers: requestHeaders
  }

  // Return a POST request to Snyk's API for creating a new
  // Integration for the Organization matching orgId as a Promise.
  return axios(newECRIntegrationOptions)
    .then(response => {
      const statusCode = response.status;
      console.log(`The response from createOrgIntegration was: ${statusCode} - ${response}`);
      if (statusCode === 201 || statusCode === 200) {
        console.log('It worked, returning the object');
        return {
          integrationId: response.data.id,
          newOrgId: orgId,
          message: `Output:\nCreated new Snyk Organization: ${orgId}\nCreated new ECR Integration: ${response.data.id}`
        };
      }
    })
    .then(finalResponse => {
      console.log(`createSnykIntegration finished with the following output: ${finalResponse}\nReturning it...`);
      return finalResponse;
    })
    .catch(e => {
      console.log(`Encountered error creating ECR integration within Snyk: ${e}`);
      return { message: `Encountered error creating ECR integration within Snyk: ${e}` };
    });

}

// Entrypoint function
//
// The handler is the function within the Lambda Function that runs
// when the Lambda is invoked. In the CloudFormation template(s) this
// is specified in the Properties section of AddSnykIntegrationLambdaFunction.
exports.handler = async (event, context) => {
  console.log(`Request Type: ${event.RequestType}`);

  // When the CloudFormation event is 'Create', talk to the Snyk API
  // and create the Organization and ECR Integration.
  try {
    switch (event.RequestType) {
      case 'Create':
        // Start the promise chain.
        // First, create a new Organization, then use its ID and the
        // other environment variables to create an ECR integration in
        // Snyk for that Organization.
        await createSnykOrg()
          .then(async (newOrgId) => {
            await createSnykIntegration(newOrgId)
              .then(async (output) => {
                // Tell CloudFormation we're done and that we succeeded.
                await cfnResponse.send(event, context, cfnResponse.SUCCESS, output);
              });
          });
        break;
      case 'Update':
      case 'Delete':
        await cfnResponse.send(event, context, cfnResponse.SUCCESS);
        break;
    }
  } catch (e) {
    // Tell CloudFormation we're done and that we failed.
    cfnResponse.send(event, context, cfnResponse.FAILED, { message: `An error occurred: ${e}` });
  }
}
