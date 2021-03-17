// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fn, Stack, Construct, StackProps, CfnParameter, CfnOutput, CfnJson, CustomResource, Duration } from '@aws-cdk/core';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId, Provider } from '@aws-cdk/custom-resources'
import { CfnDomain } from '@aws-cdk/aws-elasticsearch';
import { CfnUserPoolDomain, CfnIdentityPool, CfnIdentityPoolRoleAttachment, CfnUserPool, CfnUserPoolGroup } from '@aws-cdk/aws-cognito';
import { Effect, Role, ManagedPolicy, ServicePrincipal, FederatedPrincipal, PolicyStatement } from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';

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

    const esLimitedUserRole = new Role(this, "esLimitedUserRole", {
      assumedBy: new FederatedPrincipal('cognito-identity.amazonaws.com', {
        "StringEquals": { "cognito-identity.amazonaws.com:aud": idPool.ref },
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "authenticated"
        }
      }, "sts:AssumeRoleWithWebIdentity")
    });


    const esAdminFnRole = new Role(this, "esAdminFnRole", {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com')
    });
    esAdminFnRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"))

    const esAdminUserRole = new Role(this, "esAdminUserRole", {
      assumedBy:
        new FederatedPrincipal('cognito-identity.amazonaws.com', {
          "StringEquals": { "cognito-identity.amazonaws.com:aud": idPool.ref },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated"
          }
        }, "sts:AssumeRoleWithWebIdentity")
    });

    const elasticsearchHttpPolicy = new ManagedPolicy(this, "elasticsearchHttpPolicy", {
      roles: [esAdminUserRole, esAdminFnRole]
    });

    new CfnUserPoolGroup(this, "userPoolAdminGroupPool", {
      userPoolId: userPool.ref,
      groupName: "es-admins",
      roleArn: esAdminUserRole.roleArn
    });

    const domainArn = "arn:aws:es:" + this.region + ":" + this.account + ":domain/" + applicationPrefix + "/*"

    elasticsearchHttpPolicy.addStatements(new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [domainArn],
      actions: ['es:ESHttpPost', 'es:ESHttpGet', 'es:ESHttpPut']
    }));

    const esRole = new Role(this, "esRole", {
      assumedBy: new ServicePrincipal('es.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AmazonESCognitoAccess")]
    });

    const esDomain = new CfnDomain(this, "searchDomain", {
      elasticsearchClusterConfig: { instanceType: "t3.small.elasticsearch" },
      ebsOptions: { volumeSize: 10, ebsEnabled: true },
      elasticsearchVersion: "7.9",
      domainName: applicationPrefix,
      nodeToNodeEncryptionOptions: { enabled: true },
      encryptionAtRestOptions: { enabled: true },
      advancedSecurityOptions: {
        enabled: true,
        masterUserOptions: { masterUserArn: esAdminFnRole.roleArn }
      },
      domainEndpointOptions: {
        enforceHttps: true
      },
      cognitoOptions: {
        enabled: true,
        identityPoolId: idPool.ref,
        roleArn: esRole.roleArn,
        userPoolId: userPool.ref
      },

      // see recommended configuration for fgac
      // https://docs.aws.amazon.com/elasticsearch-service/latest/developerguide/fgac.html
      // don't use this without fgac, vpc support, or ip based restrictions
      // as it enables anonymous access
      accessPolicies: {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": {
              "AWS": "*"
            },
            "Action": "es:ESHttp*",
            "Resource": domainArn
          }
        ]
      }
    });

    const userPoolClients = new AwsCustomResource(this, 'clientIdResource', {
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [userPool.attrArn] }),
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'listUserPoolClients',
        parameters: {
          UserPoolId: userPool.ref
        },
        physicalResourceId: PhysicalResourceId.of(`ClientId-${applicationPrefix}`)
      }
    });
    userPoolClients.node.addDependency(esDomain);

    const clientId = userPoolClients.getResponseField('UserPoolClients.0.ClientId');
    const providerName = `cognito-idp.${this.region}.amazonaws.com/${userPool.ref}:${clientId}`

    new CfnIdentityPoolRoleAttachment(this, 'userPoolRoleAttachment', {
      identityPoolId: idPool.ref,
      roles: {
        'authenticated': esLimitedUserRole.roleArn
      },
      roleMappings: new CfnJson(this, 'roleMappingsJson', {
        value: {
          [providerName]: {
            Type: 'Token',
            AmbiguousRoleResolution: 'AuthenticatedRole'
          }
        }
      }
      )
    });

    /**
     * Function implementing the requests to Amazon Elasticsearch Service
     * for the custom resource.
     */
    const esRequestsFn = new lambda.Function(this, 'esRequestsFn', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'es-requests.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'functions/es-requests')),
      timeout: Duration.seconds(30),
      role: esAdminFnRole,
      environment: {
        "DOMAIN": esDomain.attrDomainEndpoint,
        "REGION": this.region
      }
    });

    const esRequestProvider = new Provider(this, 'esRequestProvider', {
      onEventHandler: esRequestsFn
    });


    /**
     * You can import files exported via Kibana's
     * Stack Management -> Save Objects as done with the
     * dashboard.ndjson below.
     */
    new CustomResource(this, 'esRequestsResource', {
      serviceToken: esRequestProvider.serviceToken,
      properties: {
        requests: [
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/tenants/logs-tenant",
            "body": {
              "description": "A tenant for the sample kibana objects."
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/all_access",
            "body": {
              "backend_roles": [
                esAdminUserRole.roleArn,
                esAdminFnRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/security_manager",
            "body": {
              "backend_roles": [
                esAdminFnRole.roleArn,
                esAdminUserRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          },
          {
            "method": "PUT",
            "path": "_template/example-index-template",
            "body": fs.readFileSync(path.join(__dirname, "index-template.json")).toString()
          },
          {
            "method": "POST",
            "path": "_plugin/kibana/api/saved_objects/_import?overwrite=true",
            "body": fs.readFileSync(path.join(__dirname, "dashboard.ndjson")).toString(),
            "securitytenant": "logs-tenant",
            "filename": "dashboard.ndjson"
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/roles/logs-role",
            "body":
            {
              "cluster_permissions": [
                "cluster_composite_ops",
                "cluster_monitor"
              ],
              "index_permissions": [{
                "index_patterns": [
                  "logs-*"
                ],
                "dls": "",
                "fls": [],
                "masked_fields": [],
                "allowed_actions": [
                  "crud",
                  "create_index"
                ]
              }],
              "tenant_permissions": [{
                "tenant_patterns": [
                  "logs-tenant"
                ],
                "allowed_actions": [
                  "kibana_all_write"
                ]
              }]
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/logs-role",
            "body": {
              "backend_roles": [
                esLimitedUserRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/kibana_user",
            "body": {
              "backend_roles": [
                esLimitedUserRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          }
        ]
      }
    });

    new CfnOutput(this, 'createUserUrl', {
      description: "Create a new user in the user pool here - add it to the es-admins group if fine grained access controls should not apply.",
      value: "https://" + this.region + ".console.aws.amazon.com/cognito/users?region=" + this.region + "#/pool/" + userPool.ref + "/users"
    });

    new CfnOutput(this, 'kibanaUrl', {
      description: "Access Kibana via this URL.",
      value: "https://" + esDomain.attrDomainEndpoint + "/_plugin/kibana/"
    });

  }
}
