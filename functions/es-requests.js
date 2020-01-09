// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require('aws-sdk');
const cfn_response = require('./cfn-response.js');

const region = process.env.REGION;
const domain = process.env.DOMAIN;

function handleSuccess(response) {
  if (response.status >= 200 && response.status < 300) {
    console.log("Successful request:", response);
  } else {
    throw new Error("Request failed: " + JSON.stringify(response)); 
  }
}

exports.handler = async function (event, context) {
  const physicalId = "TheOnlyCustomResource";
  const requests = event.ResourceProperties.Requests;

  var requestSuccessful = true;

  // run the promises sequentially
  await requests.reduce(async (previousPromise, request) => {
    return previousPromise
      .then(_result => { return sendDocument(request.method, request.path, request.body) })
      .then(handleSuccess);
  }, Promise.resolve())
    .catch(error => {
      console.log({ error });
      requestSuccessful = false;
    });

  if (event.ResponseURL) {
    console.log({requestSuccessful});
    const status = requestSuccessful ? cfn_response.SUCCESS : cfn_response.FAILED;
    await cfn_response.send(event, context, status, {}, physicalId);
  }
};

/**
 * Derived from https://github.com/awsdocs/amazon-elasticsearch-service-developer-guide/blob/master/doc_source/es-request-signing.md#node
 */
function sendDocument(httpMethod, path, document) {
  return new Promise(function (resolve, reject) {
    console.log({ httpMethod, path, document });
    
    var endpoint = new AWS.Endpoint(domain);
    var request = new AWS.HttpRequest(endpoint, region);

    // if this is a kibana request pass it to the kibana API,
    // add a xsrf header
    if (path.startsWith("api/kibana")) {
      request.path += "_plugin/kibana/";
      request.headers['kbn-xsrf'] = 'kibana';
    }

    request.path += path;
    request.method = httpMethod;
    if (typeof document === 'string') {
      request.body = document;
    }
    request.headers['host'] = domain;
    request.headers['Content-Type'] = 'application/json';
    // Content-Length is only needed for DELETE requests that include a request
    // body, but including it for all requests doesn't seem to hurt anything.
    request.headers['Content-Length'] = Buffer.byteLength(request.body);

    var credentials = new AWS.EnvironmentCredentials('AWS');
    var signer = new AWS.Signers.V4(request, 'es');
    signer.addAuthorization(credentials, new Date());

    var client = new AWS.HttpClient();
    client.handleRequest(request, null, function (response) {
      var responseBody = '';
      response.on('data', function (chunk) {
        responseBody += chunk;
      });
      response.on('end', function (_chunk) {
        resolve({ "status": response.statusCode, "body": responseBody });
      });
    }, function (error) {
      reject(error);
    });
  });
}
