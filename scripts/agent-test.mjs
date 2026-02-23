import { readFileSync } from 'fs';

const GATEWAY = 'https://agents.rickydata.org';
const TOKEN = readFileSync('/tmp/agent-token.txt', 'utf-8').trim();
const AGENT_ID = 'research-paper-analyst';

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

if (!sessionRes.ok) {
  console.error('Session creation failed:', sessionRes.status, await sessionRes.text());
  process.exit(1);
}

const session = await sessionRes.json();
const sessionId = session.id;
console.log('Session created:', sessionId);
console.log('Model:', session.model);

// Step 2: Send chat message
console.log('\nSending message to agent...\n');
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

if (!chatRes.ok) {
  console.error('Chat failed:', chatRes.status, await chatRes.text());
  process.exit(1);
}

console.log('Chat response status:', chatRes.status);
console.log('Content-Type:', chatRes.headers.get('content-type'));

// Read the response - could be SSE or JSON
const contentType = chatRes.headers.get('content-type') || '';

if (contentType.includes('text/event-stream')) {
  console.log('\n--- SSE Stream ---\n');
  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let toolCalls = [];
  let textOutput = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });

    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text' || event.type === 'content') {
            const t = event.data || event.text || event.content || '';
            process.stdout.write(t);
            textOutput += t;
          } else if (event.type === 'tool_call' || event.type === 'tool_use') {
            const name = event.name || event.tool || '';
            const args = JSON.stringify(event.arguments || event.input || {}).slice(0, 300);
            console.log(`\n[TOOL CALL] ${name}(${args})`);
            toolCalls.push(name);
          } else if (event.type === 'tool_result') {
            const data = (event.data || event.result || '').toString().slice(0, 400);
            console.log(`[TOOL RESULT] ${data}`);
          } else if (event.type === 'done' || event.type === 'end' || event.type === 'message_stop') {
            console.log('\n\n[DONE]', JSON.stringify(event.data || ''));
          } else if (event.type === 'error') {
            console.error('\n[ERROR]', JSON.stringify(event));
          } else {
            // Log unknown event types for debugging
            console.log(`\n[${event.type}]`, JSON.stringify(event).slice(0, 200));
          }
        } catch (e) {
          // Not valid JSON, might be [DONE] marker
          if (line.trim() === 'data: [DONE]') {
            console.log('\n[STREAM DONE]');
          }
        }
      }
    }
  }

  console.log('\n\n--- Stream Complete ---');
  console.log('Tool calls made:', toolCalls);
  console.log('Text output length:', textOutput.length);
} else {
  // Regular JSON response
  const responseData = await chatRes.json();
  console.log('\n--- JSON Response ---');
  console.log(JSON.stringify(responseData, null, 2).slice(0, 3000));
}

console.log('\nAgent interaction complete.');
