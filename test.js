#! /usr/bin/env node
'use strict';

require("babel-core/register")
require("babel-polyfill")
var index = require('./index.js')

console.log('Hello world')
index.test();