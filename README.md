# Launch Amazon Elasticsearch Service with Amazon Cognito User Pools

To get started with [Amazon Elasticsearch Service](https://aws.amazon.com/elasticsearch-service/) (Amazon ES), you must have a concept for authentication and authorization for your search cluster. In addition to an IP-based access policy or a proxy server to protect your search cluster, you can leverage AWS Identity and Access Management (IAM) with Amazon Cognito User Pools to authenticate and authorize users. You can configure this using the AWS Management Console or the AWS Command Line Interface (AWS CLI). More information on configuration can be found in the [Amazon Cognito Authentication for Kibana documentation](https://docs.aws.amazon.com/elasticsearch-service/latest/developerguide/es-cognito-auth.html).

An Infrastructure-as-Code approach allows you to complete deployment and configuration in a safe, repeatable manner, so you can build and rebuild your search cluster automatically.

This is the sample code for the concepts described in the blog post [Launch Amazon Elasticsearch Service with Amazon Cognito User Pools](https://aws.amazon.com/blogs/field-notes/launch-amazon-elasticsearch-service-with-amazon-cognito-user-pools/). It contains a [AWS Cloud Development Kit](https://aws.amazon.com/cdk/) (AWS CDK) template for the fully automated provisioning of the Amazon ES and Amazon Cognito resources, as well as your first search index and Kibana dashboard. The template structure is also applicable if you prefer to use AWS CloudFormation.

## Get Started

Deploy the sample template from the AWS Serverless Application Repository:

[![cloudformation-launch-button](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:387304072572:applications~amazon-elasticsearch-service-with-cognito)

## Deploy the template from code

The template provisions an Amazon Elasticsearch Service cluster in a fully automated way. The search cluster consists of a single `t2.small.elasticsearch` instance with 10GB of EBS storage. It is integrated with Amazon Cognito User Pools so you only need to add your user(s). The template also configures an example Kibana dashboard and an Amazon ES index template.

The template prefixes the search domain and the Amazon Cognito Hosted UI with a string that you can define with the `applicationPrefix` template parameter.

You can either deploy the template with AWS CloudFormation or CDK. Both options require you to install and configure the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html) and the [CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html).

The CDK template is written in TypeScript. TypeScript sources must be compiled to JavaScript initially and after each modification. Open a new terminal and keep this terminal open in the background if you like to change the source files. Change the directory to the one where `cdk.json` is and execute:

```bash
npm install
npm run watch
```

Read the [CDK developer guide](https://docs.aws.amazon.com/cdk/latest/guide/home.html) for more information.

### Option 1: Deployment using AWS CloudFormation

Synthesize the CDK template to an AWS CloudFormation template:

```bash
cdk synth --version-reporting false > synth.yaml
```

Package the template for deployment. AWS CloudFormation [transforms](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-deploying.html) the AWS Serverless Application Model (AWS SAM) syntax to AWS CloudFormation code and uploads the package to a bucket of your choice. The bucket must be in the region in which you want to deploy the sample application:

```bash
aws cloudformation package \
    --template-file synth.yaml \
    --output-template-file packaged.yaml \
    --s3-bucket <BUCKET> \
    --region <REGION>
```

Deploy the packaged application to your account:

```bash
aws cloudformation deploy
    --template-file packaged.yaml \
    --stack-name <STACKNAME> \
    --parameter-overrides applicationPrefix=<PREFIX> \
    --capabilities CAPABILITY_IAM \
    --region <REGION>
```

### Option 2: Deployment using CDK

CDK needs the AWS Lambda function code already packaged in S3. Run the synthesize and package steps to package the code:

```bash
cdk synth > synth.yaml
aws cloudformation package \
    --template-file synth.yaml \
    --output-template-file packaged.yaml \
    --s3-bucket <BUCKET> \
    --region <REGION>
```

Create or update the application with `cdk deploy`. This CDK template can retrieve the S3 URL to your AWS Lambda function code package from the previously packaged template – provided in the `SAM_PACKAGED_TEMPLATE` environment variable:

```bash
SAM_PACKAGED_TEMPLATE=$(cat packaged.yaml) \
    AWS_DEFAULT_REGION=<REGION> \
    cdk deploy -c applicationPrefix=<PREFIX>
```

### Access the Example Dashboard

As soon as the application is deployed completely the outputs of the AWS CloudFormation stack provides the links for the next steps. You will find two URLs in the AWS CloudFormation console called `createUserUrl` and `kibanaUrl`.

![AWS CloudFormation outputs](img/cfn_outputs.png)

* Use the `createUserUrl` link from the outputs, or navigate to the Amazon Cognito user pool in the console to create a new user in the pool. **Enter an email address as username and email**. **Enter a temporary password** of your choice with at least 8 characters. Leave the phone number empty and **uncheck the checkbox to mark the phone number as verified**. If you like you can check the checkboxes to send an invitation to the new user or to make the user verify the email address. Then choose **Create user**.

    ![AWS CloudFormation outputs](img/create_user.png)

* Access the Kibana dashboard with the `kibanaUrl` link from the outputs, or navigate to the Kibana link displayed in the Amazon Elasticsearch Service console. In Kibana, choose the Dashboard icon in the left menu bar and open the *Example Dashboard*. The dashboard contains instructions to add new documents to the search index and to visualize the documents with the graph in the dashboard.

    ![AWS CloudFormation outputs](img/example_dashboard.png)

## Cleaning Up

To avoid incurring charges, delete the AWS CloudFormation stack when you are finished experimenting:

* Sign in to the AWS CloudFormation console and choose your stack.
* Choose **Delete** to delete all resources, including the search cluster and the Amazon Cognito user pool.

## FAQs

### Q: In which region can I deploy the sample application?

The Launch Stack button above opens the AWS Serverless Application Repository in the US East 1 (Northern Virginia) region. You may switch to other regions from there before deployment.

### Q: How much do resources in this template cost?

Standard AWS charges apply to the resources you deploy with this template.

Amazon Elasticsearch Service provides customers in the [AWS Free Tier](https://aws.amazon.com/free/) free usage of up to 750 hours per month of the configuration in this template, i.e. a single-AZ `t2.small.elasticsearch` instance and 10GB of EBS storage for up to one year from the date the account was created. If you exceed the free tier limits, you will be charged the Amazon Elasticsearch Service rates for the additional resources you use.

The Amazon Cognito User Pool feature has a free tier of 50,000 monthly active users for users who sign in directly to Cognito User Pools. The free tier does not automatically expire at the end of your 12 month AWS Free Tier term, and it is available to both existing and new AWS customers indefinitely.

See offer terms of [Amazon Cognito](https://aws.amazon.com/cognito/pricing/) and [Amazon Elasticsearch Service](https://aws.amazon.com/elasticsearch-service/pricing/) for more details.

### Q: How can I add a new question to this list?

If you found yourself wishing this set of frequently asked questions had an answer for a particular problem, please [submit a pull request](https://help.github.com/articles/creating-a-pull-request-from-a-fork/). The chances are good that others will also benefit from having the answer listed here.

### Q: How can I contribute?

See the [Contributing Guidelines](CONTRIBUTING.md) for details.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.