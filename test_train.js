const fetch = require('node-fetch');

async function testTraining(studentId) {
    console.log(`Testing training for student ${studentId}...`);
    // Create a dummy descriptor (128 floats)
    const descriptor = Array(128).fill(0.123);

    try {
        const response = await fetch('http://localhost:3000/api/faces/train', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentId: studentId,
                descriptor: descriptor,
                confidence: 0.99
            })
        });

        const text = await response.text();
        console.log(`Status: ${response.status}`);
        console.log(`Response: ${text}`);
    } catch (e) {
        console.error('Error:', e);
    }
}

testTraining(1); // Assuming student ID 1 exists
