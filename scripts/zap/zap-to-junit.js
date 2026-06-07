#!/usr/bin/env node

/**
 * Converts OWASP ZAP JSON reports to JUnit XML format.
 * Each ZAP alert becomes a test case; Medium- and High-risk alerts fail, while Low and Informational alerts pass.
 * Usage: node zap-to-junit.js <zap-report.json> <output.xml> [scan-name]
 */

const fs = require('fs');
const path = require('path');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function riskName(code) {
  switch (code) {
    case '3': return 'High';
    case '2': return 'Medium';
    case '1': return 'Low';
    case '0': return 'Informational';
    default:  return 'Unknown';
  }
}

function confidenceName(code) {
  switch (code) {
    case '3': return 'High';
    case '2': return 'Medium';
    case '1': return 'Low';
    case '0': return 'False Positive';
    default:  return 'Unknown';
  }
}

function convert(inputPath, outputPath, suiteName) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const report = JSON.parse(raw);

  const alerts = [];
  for (const site of (report.site || [])) {
    for (const alert of (site.alerts || [])) {
      alerts.push({
        name: alert.name || 'Unknown Alert',
        riskcode: alert.riskcode || '0',
        riskdesc: alert.riskdesc || '',
        confidence: alert.confidence || '0',
        desc: (alert.desc || '').trim(),
        solution: (alert.solution || '').trim(),
        reference: (alert.reference || '').trim(),
        cweid: alert.cweid || '',
        wascid: alert.wascid || '',
        instances: alert.instances || [],
        pluginid: alert.pluginid || '',
      });
    }
  }

  // Alerts with riskcode >= 2 (Medium+) are failures; Low and Info are passed
  const failures = alerts.filter(a => parseInt(a.riskcode, 10) >= 2);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuites>\n`;
  xml += `  <testsuite name="${escapeXml(suiteName)}" `;
  xml += `tests="${alerts.length}" `;
  xml += `failures="${failures.length}" `;
  xml += `errors="0" `;
  xml += `skipped="0">\n`;

  for (const alert of alerts) {
    const risk = riskName(alert.riskcode);
    const isFail = parseInt(alert.riskcode, 10) >= 2;
    const testName = `[${risk}] ${alert.name}`;
    const className = `ZAP.${suiteName.replace(/\s+/g, '')}`;

    xml += `    <testcase name="${escapeXml(testName)}" classname="${escapeXml(className)}">\n`;

    if (isFail) {
      const instanceSummary = alert.instances.length > 0
        ? alert.instances.slice(0, 5).map(i =>
            `  URL: ${i.uri || 'N/A'} | Method: ${i.method || 'N/A'} | Param: ${i.param || 'N/A'}`
          ).join('\n')
        : '  No instance details available';

      const message = `${risk} risk (Confidence: ${confidenceName(alert.confidence)})` +
        (alert.cweid ? ` | CWE-${alert.cweid}` : '') +
        (alert.wascid ? ` | WASC-${alert.wascid}` : '');

      const body = [
        alert.desc,
        '',
        `Plugin ID: ${alert.pluginid}`,
        `Instances (${alert.instances.length}):`,
        instanceSummary,
        '',
        alert.solution ? `Solution: ${alert.solution}` : '',
        alert.reference ? `Reference: ${alert.reference}` : '',
      ].filter(Boolean).join('\n');

      xml += `      <failure message="${escapeXml(message)}">${escapeXml(body)}</failure>\n`;
    }

    xml += `    </testcase>\n`;
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, xml, 'utf8');

  console.log(`Converted ${alerts.length} alerts (${failures.length} failures) → ${outputPath}`);
}

// CLI entry point
const [,, inputPath, outputPath, suiteName = 'OWASP ZAP'] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node zap-to-junit.js <zap-report.json> <output.xml> [scan-name]');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.warn(`Warning: Input file not found: ${inputPath}`);
  process.exit(0);
}

convert(inputPath, outputPath, suiteName);
