// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const AWS = require('aws-sdk');

const region = process.env.REGION;
const domain = process.env.DOMAIN;

function handleSuccess(response) {
  if (response.status >= 200 && response.status < 300) {
    console.log("Successful request:", response);
  } else {
    throw new Error("Request failed: " + JSON.stringify(response));
  }
}

exports.handler = async function (event, _context) {
  console.log({ event });

  const requestType = event.RequestType;

  if (requestType === "Create" || requestType === "Update") {
    const requests = event.ResourceProperties.requests;
    // run the promises sequentially
    var requestSuccessful = true;
    await requests.reduce(async (previousPromise, request) => {
      console.log({ request })
      return previousPromise
        .then(_result => { return sendDocument(request.method, request.path, request.body, request.securitytenant, request.filename) })
        .then(handleSuccess);
    }, Promise.resolve())
      .catch(error => {
        console.log({ error });
        requestSuccessful = false;
      });

    if (!requestSuccessful) {
      throw new Error("One of the requests failed, see logs");
    }
  }
};

/**
 * Derived from https://github.com/awsdocs/amazon-elasticsearch-service-developer-guide/blob/master/doc_source/es-request-signing.md#node
 */
function sendDocument(httpMethod, path, document, securitytenant, filename) {
  return new Promise(function (resolve, reject) {
    console.log({ httpMethod, path, document });

    var endpoint = new AWS.Endpoint(domain);
    var request = new AWS.HttpRequest(endpoint, region);

    // if this is a kibana request
    // add a xsrf header
    if (path.startsWith("_plugin/kibana/")) {
      request.headers['kbn-xsrf'] = 'kibana';
    }

    request.path += path;
    request.method = httpMethod;
    const payload = [];

    if (typeof securitytenant === 'string') {
      request.headers['securitytenant'] = securitytenant;
    }

    if (typeof filename === 'string') {
      const boundary = "----MyBoundary";
      request.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      payload.push(`--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        `Content-Type: application/octet-stream`,
        "",
        document,
        "",
        `--${boundary}--`);
    } else {
      request.headers['Content-Type'] = 'application/json';
      if (typeof document === 'string') {
        payload.push(document); 
      } else if  (typeof document === 'object') {
        payload.push(JSON.stringify(document));
      }
    }

    request.body = payload.join("\r\n");

    request.headers['host'] = domain;
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
