import { readFileSync, writeFileSync, appendFileSync } from 'fs';

const GATEWAY = 'https://agents.rickydata.org';
const TOKEN = readFileSync('/tmp/agent-token.txt', 'utf-8').trim();
const AGENT_ID = 'research-paper-analyst';
const RAW_LOG = '/tmp/agent-raw-sse.log';

// Clear log
writeFileSync(RAW_LOG, '');

// Step 1: Create session
console.log('Creating session...');
const sessionRes = await fetch(`${GATEWAY}/agents/${AGENT_ID}/sessions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});

const session = await sessionRes.json();
const sessionId = session.id;
console.log('Session created:', sessionId);

// Step 2: Send chat message
console.log('\nSending message...\n');
const chatRes = await fetch(`${GATEWAY}/agents/${AGENT_ID}/sessions/${sessionId}/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'Find and analyze the Claimify paper (arXiv 2502.10855). Extract atomic claims using the Claimify methodology. Then publish them to the Geo knowledge graph using create_research_ontology_paper_and_claims and publish_edit. Report back what you published.',
  }),
});

console.log('Status:', chatRes.status);

const reader = chatRes.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let toolCalls = [];
let textChunks = [];

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  buffer += chunk;

  // Process complete lines
  while (buffer.includes('\n')) {
    const newlineIdx = buffer.indexOf('\n');
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);

    if (!line || line.startsWith(':')) continue;

    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        console.log('\n[STREAM DONE]');
        continue;
      }

      try {
        const event = JSON.parse(data);
        appendFileSync(RAW_LOG, JSON.stringify(event) + '\n');

        switch (event.type) {
          case 'text':
          case 'content_block_delta':
            const text = event.data || event.delta?.text || '';
            if (text) {
              process.stdout.write(text);
              textChunks.push(text);
            }
            break;
          case 'tool_call':
          case 'tool_use':
          case 'content_block_start':
            if (event.content_block?.type === 'tool_use' || event.name || event.tool) {
              const name = event.name || event.tool || event.content_block?.name || '';
              const args = JSON.stringify(event.arguments || event.input || event.content_block?.input || {}).slice(0, 500);
              console.log(`\n[TOOL] ${name} ${args !== '{}' ? args : ''}`);
              if (name) toolCalls.push(name);
            }
            break;
          case 'tool_result':
            const result = JSON.stringify(event.data || event.result || event.content || '').slice(0, 500);
            console.log(`[RESULT] ${result}`);
            break;
          case 'tool_error':
            console.log(`[TOOL ERROR] ${JSON.stringify(event.data || event.error || '').slice(0, 500)}`);
            break;
          case 'done':
          case 'message_stop':
            console.log('\n[DONE]');
            break;
          default:
            // Log first occurrence of unknown types
            console.log(`[${event.type}] ${JSON.stringify(event).slice(0, 300)}`);
        }
      } catch (e) {
        // Not JSON
      }
    }
  }
}

console.log('\n\n=== SUMMARY ===');
console.log('Tool calls:', toolCalls.length);
console.log('Tool names:', [...new Set(toolCalls)]);
console.log('Text output chars:', textChunks.join('').length);
console.log('Raw SSE log saved to:', RAW_LOG);
