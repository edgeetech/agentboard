#!/usr/bin/env node
// End-to-end test: Create task → PM agent → Worker agent → Human Approval

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Colors for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(color, prefix, msg) {
  console.log(`${color}[${prefix}]${RESET} ${msg}`);
}

function logPass(msg) { log(GREEN, 'PASS', msg); }
function logFail(msg) { log(RED, 'FAIL', msg); }
function logInfo(msg) { log(YELLOW, 'INFO', msg); }

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiCall(method, endpoint, body = null) {
  const config = JSON.parse(readFileSync(join(process.env.HOME || process.env.USERPROFILE, '.agentboard', 'config.json')));
  const token = config.token;
  const baseUrl = 'http://127.0.0.1:56847'; // Update if port changes

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${baseUrl}${endpoint}`, opts);
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  logInfo('E2E Test: Copilot Agent Workflow');
  logInfo('=================================');

  // Step 1: Create task
  logInfo('Step 1: Creating task...');
  const createResp = await apiCall('POST', '/api/tasks', {
    project: 'TEST',
    title: 'E2E-TEST-' + Date.now(),
    description: 'Add 1 dummy AC and pass the task to the next agent.',
  });

  if (!createResp?.task?.code) {
    logFail('Failed to create task');
    return;
  }

  const taskCode = createResp.task.code;
  logPass(`Task created: ${taskCode}`);

  // Step 2: Wait for PM agent to complete
  logInfo('Step 2: Waiting for PM agent to complete (30 seconds)...');
  await sleep(30000);

  // Check task status after PM
  const pmResp = await apiCall('GET', `/api/tasks/${taskCode}`);
  const taskAfterPM = pmResp?.task;

  if (!taskAfterPM) {
    logFail('Task not found after PM run');
    return;
  }

  logInfo(`After PM: status=${taskAfterPM.status}, assignee=${taskAfterPM.assignee_role}`);

  // Check if PM added AC
  if (JSON.parse(taskAfterPM.acceptance_criteria_json || '[]').length === 0) {
    logFail('PM did not add acceptance criteria');
  } else {
    logPass(`PM added ${JSON.parse(taskAfterPM.acceptance_criteria_json).length} acceptance criteria`);
  }

  // Step 3: Wait for Worker agent
  if (taskAfterPM.assignee_role === 'worker' && taskAfterPM.status === 'agent_working') {
    logPass('Worker agent dispatched');
    logInfo('Step 3: Waiting for Worker agent to complete (30 seconds)...');
    await sleep(30000);

    // Check task status after Worker
    const workerResp = await apiCall('GET', `/api/tasks/${taskCode}`);
    const taskAfterWorker = workerResp?.task;

    logInfo(`After Worker: status=${taskAfterWorker.status}, assignee=${taskAfterWorker.assignee_role}`);

    // Step 4: Check final state
    if (taskAfterWorker.status === 'human_approval' || taskAfterWorker.assignee_role === 'human') {
      logPass('Task reached Human Approval phase');
      logPass('=== E2E TEST PASSED ===');
    } else if (taskAfterWorker.status === 'agent_review') {
      logPass('Task moved to Agent Review (Reviewer next)');
    } else {
      logFail(`Unexpected final status: ${taskAfterWorker.status} assignee: ${taskAfterWorker.assignee_role}`);
    }
  } else {
    logFail(`Worker not dispatched. status=${taskAfterPM.status}, assignee=${taskAfterPM.assignee_role}`);
  }
}

main().catch(err => {
  logFail(`Test error: ${err.message}`);
  process.exit(1);
});
