#!/usr/bin/env node
// End-to-end test: Create task → PM agent → Worker agent → Human Approval

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Colors for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(color: string, prefix: string, msg: string): void {
  console.log(`${color}[${prefix}]${RESET} ${msg}`);
}

function logPass(msg: string): void {
  log(GREEN, 'PASS', msg);
}
function logFail(msg: string): void {
  log(RED, 'FAIL', msg);
}
function logInfo(msg: string): void {
  log(YELLOW, 'INFO', msg);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ApiConfig {
  token: string;
}

interface ApiResponse {
  task?: {
    code: string;
    status: string;
    assignee_role: string;
    acceptance_criteria_json: string;
  };
}

async function apiCall(
  method: string,
  endpoint: string,
  body: Record<string, unknown> | null = null,
): Promise<ApiResponse | null> {
  const configPath = join(
    process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    '.agentboard',
    'config.json',
  );
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as ApiConfig;
  const token = config.token;
  const baseUrl = 'http://127.0.0.1:56847'; // Update if port changes

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${baseUrl}${endpoint}`, opts);
  const text = await resp.text();
  return text ? (JSON.parse(text) as ApiResponse) : null;
}

async function main(): Promise<void> {
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
  await sleep(30_000);

  // Check task status after PM
  const pmResp = await apiCall('GET', `/api/tasks/${taskCode}`);
  const taskAfterPM = pmResp?.task;

  if (!taskAfterPM) {
    logFail('Task not found after PM run');
    return;
  }

  logInfo(`After PM: status=${taskAfterPM.status}, assignee=${taskAfterPM.assignee_role}`);

  // Check if PM added AC
  const acList = JSON.parse(taskAfterPM.acceptance_criteria_json || '[]') as unknown[];
  if (acList.length === 0) {
    logFail('PM did not add acceptance criteria');
  } else {
    logPass(`PM added ${acList.length} acceptance criteria`);
  }

  // Step 3: Wait for Worker agent
  if (taskAfterPM.assignee_role === 'worker' && taskAfterPM.status === 'agent_working') {
    logPass('Worker agent dispatched');
    logInfo('Step 3: Waiting for Worker agent to complete (30 seconds)...');
    await sleep(30_000);

    // Check task status after Worker
    const workerResp = await apiCall('GET', `/api/tasks/${taskCode}`);
    const taskAfterWorker = workerResp?.task;

    if (!taskAfterWorker) {
      logFail('Task not found after Worker run');
      return;
    }

    logInfo(
      `After Worker: status=${taskAfterWorker.status}, assignee=${taskAfterWorker.assignee_role}`,
    );

    // Step 4: Check final state
    if (taskAfterWorker.status === 'human_approval' || taskAfterWorker.assignee_role === 'human') {
      logPass('Task reached Human Approval phase');
      logPass('=== E2E TEST PASSED ===');
    } else if (taskAfterWorker.status === 'agent_review') {
      logPass('Task moved to Agent Review (Reviewer next)');
    } else {
      logFail(
        `Unexpected final status: ${taskAfterWorker.status} assignee: ${taskAfterWorker.assignee_role}`,
      );
    }
  } else {
    logFail(
      `Worker not dispatched. status=${taskAfterPM.status}, assignee=${taskAfterPM.assignee_role}`,
    );
  }
}

main().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logFail(`Test error: ${error.message}`);
  process.exit(1);
});
