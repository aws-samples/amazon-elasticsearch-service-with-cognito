#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { SearchStack } from '../lib/search-stack';

const app = new cdk.App();
new SearchStack(app, 'searchStack');
