// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fn, Construct, Token } from '@aws-cdk/core';
import { ICustomResourceProvider, CustomResourceProviderConfig } from '@aws-cdk/aws-cloudformation';
import { CfnFunction } from '@aws-cdk/aws-sam';
import YAML = require('yaml');

export class SamFunction extends CfnFunction {

    /**
     * Override renderProperties and replace the CodeUri with the one packaged before by cfn so cdk deploy works.
     * The packaged template must be written to an environment variable, i.e. instead of calling "cdk deploy" directly, use:
     * 
     * (cdk synth > synth.yaml && 
     * aws cloudformation package --template-file synth.yaml --s3-bucket <BUCKET> --output-template-file packaged.yaml && 
     * export SAM_PACKAGED_TEMPLATE=$(cat packaged.yaml) && 
     * cdk deploy)
     */
    public renderProperties(props: { [key: string]: any; }): { [key: string]: any; } {
  
      const CODE_URI = 'CodeUri';
  
      const newProps = super.renderProperties(props);
  
      const packagedStr = process.env.SAM_PACKAGED_TEMPLATE;
      if (typeof packagedStr === 'string') {
        const logicalId = this.logicalId.split('.')[1];
        const packaged = YAML.parse(packagedStr);
        newProps[CODE_URI] = packaged['Resources'][logicalId]['Properties'][CODE_URI];
      }
  
      return newProps;
    }
  
  }
  
  /**
   * Provider to link the CustomResourceProvider construct with sam's CfnFunction
   */
  export class SamFunctionCustomResourceProvider implements ICustomResourceProvider {
  
    readonly serviceToken: string;
  
    constructor(samFunction: CfnFunction) {
      this.serviceToken = Token.asString(Fn.getAtt(samFunction.logicalId, "Arn"));
    }
  
    bind(_scope: Construct): CustomResourceProviderConfig {
      return { serviceToken: this.serviceToken };
    }
  }
  