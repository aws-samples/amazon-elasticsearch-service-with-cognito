// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fn, Stack, Construct, StackProps, CfnParameter, CfnOutput } from '@aws-cdk/core';
import { CfnDomain } from '@aws-cdk/aws-elasticsearch';
import { CfnUserPoolDomain, CfnIdentityPool, CfnIdentityPoolRoleAttachment, CfnUserPool } from '@aws-cdk/aws-cognito';
import { Role, ManagedPolicy, ServicePrincipal, FederatedPrincipal } from '@aws-cdk/aws-iam';
import { CustomResource } from '@aws-cdk/aws-cloudformation';

import { SamFunction, SamFunctionCustomResourceProvider } from "./sam-resources";

import path = require('path');
import fs = require('fs');

export class SearchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {

    super(scope, id, props);

    const applicationPrefix = new CfnParameter(this, 'applicationPrefix', { 
      default: this.node.tryGetContext('applicationPrefix'),
      description: "Prefix for the Amazon Cognito domain and the Amazon Elasticsearch Service domain",
      type: "String",
      allowedPattern: "^[a-z0-9]*$",
      minLength: 3,
      maxLength: 20 
    }).valueAsString;

    const userPool = new CfnUserPool(this, "userPool", {
      adminCreateUserConfig: {
        allowAdminCreateUserOnly: true
      },
      policies: { passwordPolicy: { minimumLength: 8 } },
      usernameAttributes: ["email"],
      autoVerifiedAttributes: ["email"],
    });

    // get a unique suffix from the last element of the stackId, e.g. 06b321d6b6e2
    const suffix = Fn.select(4, Fn.split("-", Fn.select(2, Fn.split("/", this.stackId))));

    new CfnUserPoolDomain(this, "cognitoDomain", {
      domain: applicationPrefix + "-" + suffix,
      userPoolId: userPool.ref
    });

    const idPool = new CfnIdentityPool(this, "identityPool", {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: []
    });

    const authRole = new Role(this, "authRole", {
      assumedBy: new FederatedPrincipal('cognito-identity.amazonaws.com', {
        "StringEquals": { "cognito-identity.amazonaws.com:aud": idPool.ref },
        "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" },
      }, "sts:AssumeRoleWithWebIdentity")
    });

    const esRole = new Role(this, "esRole", {
      assumedBy: new ServicePrincipal('es.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AmazonESCognitoAccess")]
    });

    const esDomain = new CfnDomain(this, "searchDomain", {
      elasticsearchClusterConfig: { instanceType: "t2.small.elasticsearch" },
      ebsOptions: { volumeSize: 10, ebsEnabled: true },
      elasticsearchVersion: "7.4",
      domainName: applicationPrefix,

      // Trust the cognito authenticated Role
      accessPolicies: {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": {
              "AWS": authRole.roleArn
            },
            "Action": [
              "es:ESHttpGet",
              "es:ESHttpPut",
              "es:ESHttpPost",
              "es:ESHttpDelete"
            ],
            "Resource": "arn:aws:es:" + this.region + ":" + this.account + ":domain/" + applicationPrefix + "/*"
          }
        ]
      }
    });

    // put to CfnDomain as soon as supported by cdk, see https://github.com/aws/aws-cdk/issues/2342
    esDomain.addPropertyOverride('CognitoOptions.Enabled', true);
    esDomain.addPropertyOverride('CognitoOptions.IdentityPoolId', idPool.ref);
    esDomain.addPropertyOverride('CognitoOptions.RoleArn', esRole.roleArn);
    esDomain.addPropertyOverride('CognitoOptions.UserPoolId', userPool.ref);

    new CfnOutput(this, 'createUserUrl', { 
      description: "Create a new user in the user pool here.",
      value: "https://" + this.region + ".console.aws.amazon.com/cognito/users?region=" + this.region + "#/pool/" + userPool.ref + "/users"
    });

    new CfnOutput(this, 'kibanaUrl', { 
      description: "Access Kibana via this URL.",
      value: "https://" + esDomain.attrDomainEndpoint + "/_plugin/kibana/"
    });

    new CfnIdentityPoolRoleAttachment(this, 'userPoolRoleAttachment', {
      identityPoolId: idPool.ref,
      roles: {
        'authenticated': authRole.roleArn
      }
    });

    const esRequestsFn = new SamFunction(this, 'esRequestsFn', {
      runtime: "nodejs10.x",
      handler: 'es-requests.handler',
      codeUri: path.join(__dirname, "..", "functions"),
      policies: [
        { elasticsearchHttpPostPolicy: { domainName: esDomain.domainName! } }
      ],
      environment: {
        variables: {
          "DOMAIN": esDomain.attrDomainEndpoint,
          "REGION": this.region
        }
      },
    });


    /**
     * Add the scripts that should be executed as part of the depoyment here.
     * Don't try to import what has been exported via the console, but use the
     * export from the the API:
     * 
     * GET to api/kibana/dashboards/export?dashboard=<dashboardId>
     */
    new CustomResource(this, 'esRequestsResource', {
      provider: new SamFunctionCustomResourceProvider(esRequestsFn),
      properties: {
        requests: [
          {
            "method": "PUT",
            "path": "_template/example-index-template",
            "body": fs.readFileSync(path.join(__dirname, "index-template.json")).toString()
          },
          {
            "method": "POST",
            "path": "api/kibana/dashboards/import",
            "body": fs.readFileSync(path.join(__dirname, "dashboard.json")).toString()
          }
        ]
      }
    });
  }
}
