import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';

let server;
const port = 8081;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    
    // Remove query params
    filePath = filePath.split('?')[0];

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
      case '.js':
        contentType = 'text/javascript';
        break;
      case '.css':
        contentType = 'text/css';
        break;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });
  server.listen(port);
});

test.afterAll(async () => {
  server.close();
});

test('should load without console errors', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('uhst.io') && !text.includes('CORS')) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });

  await page.goto(`http://localhost:${port}`);
  
  // Wait a bit for async scripts
  await page.waitForTimeout(1000);

  expect(errors).toEqual([]);
});
