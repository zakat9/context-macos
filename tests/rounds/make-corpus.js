#!/usr/bin/env node
/* Writes the synthetic corpus of round 2 as ordinary files, for a live comparison on a real computer:
 *   node tests/rounds/make-corpus.js <empty-folder>
 * Everything in it is fictional. Notes are .md files and mail is .eml files, so any tool can open them. */
'use strict';
var path = require('path'), L = require('./lib.js'), dir = process.argv[2];
if (!dir) { console.error('Give an empty folder to write the corpus into.'); process.exit(1); }
var f = L.writeFileCorpus(path.resolve(dir)), KEY = require('./answer-key.json');
console.log('Corpus written to ' + path.resolve(dir) + '\n\nTag these six with Cost (Work Index arm only):');
['workbook', 'kestrel', 'quote', 'request', 'approval', 'note'].forEach(function (k) { console.log('  ' + path.basename(f[k])); });
console.log('\nLeave these untagged (they hold stale or irrelevant lines that must not reach the answer):');
['oldCopy', 'lunch', 'trip'].forEach(function (k) { console.log('  ' + path.basename(f[k])); });
console.log('\nQuestions (ask each in a clean session):');
KEY.values.slice(0, 4).map(function (v) { return v.question; }).concat([KEY.requestVsApproval.question]).forEach(function (q, i) { console.log('  ' + (i + 1) + '. ' + q); });
console.log('\nScore each saved answer:  node tests/rounds/score-answer.js <answer.txt>');
