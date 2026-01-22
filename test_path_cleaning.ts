/**
 * Test script to verify path cleaning logic
 */

// Copy of cleanPath function
const cleanPath = (path: string): string => {
  if (!path) return '';
  // Remove \\?\ or \\?\UNC\ prefix from Windows paths
  return path.replace(/^\\\\\?\\(UNC\\)?/, '');
};

// Test cases
const testCases = [
  {
    input: '\\\\?\\C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    expected: 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    description: 'Windows long path with \\?\ prefix'
  },
  {
    input: '\\\\?\\UNC\\server\\share\\ffmpeg.exe',
    expected: 'server\\share\\ffmpeg.exe',
    description: 'UNC path with \\?\UNC\ prefix'
  },
  {
    input: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    expected: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    description: 'Normal Windows path without prefix'
  },
  {
    input: '/usr/bin/ffmpeg',
    expected: '/usr/bin/ffmpeg',
    description: 'Linux path'
  },
  {
    input: '',
    expected: '',
    description: 'Empty path'
  }
];

// Run tests
console.log('Path Cleaning Tests');
console.log('==================\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, i) => {
  const result = cleanPath(test.input);
  const success = result === test.expected;
  
  if (success) {
    passed++;
    console.log(`✓ Test ${i + 1}: ${test.description}`);
  } else {
    failed++;
    console.log(`✗ Test ${i + 1}: ${test.description}`);
    console.log(`  Input:    "${test.input}"`);
    console.log(`  Expected: "${test.expected}"`);
    console.log(`  Got:      "${result}"`);
  }
  console.log();
});

console.log(`Results: ${passed} passed, ${failed} failed`);
