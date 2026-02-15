const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const net = require('net');

// Configuration constants
const DEFAULT_PORT = 3000;
const SERVER_STARTUP_DELAY_MS = 3000;
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 720;

let mainWindow;
let serverProcess;

/**
 * Recursively finds the next available port starting from a given port number
 * @param {number} currentPort - The port number to check
 * @param {Function} callback - Callback function that receives the available port
 */
function findNextAvailablePort(currentPort, callback) {
    const server = net.createServer();

    server.listen(currentPort, () => {
        server.once('close', () => {
            callback(currentPort);
        });
        server.close();
    });

    server.on('error', () => {
        findNextAvailablePort(++currentPort, callback);
    });
}

/**
 * Gets an available port starting from the specified port number
 * @param {number} startingPort - The initial port number to check
 * @returns {Promise<number>} Promise that resolves with an available port number
 */
function getAvailablePort(startingPort) {
    return new Promise(resolve => {
        findNextAvailablePort(startingPort, resolve);
    });
}

/**
 * Starts the Express server in a separate process
 * @returns {Promise<number>} Promise that resolves with the server port number
 */
async function startServer() {
    const port = await getAvailablePort(DEFAULT_PORT);
    const userDataPath = app.getPath('userData');

    const serverConfig = {
        env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: port,
            USER_DATA_PATH: userDataPath
        },
        silent: false
    };

    serverProcess = fork(path.join(__dirname, 'server.js'), [], serverConfig);

    serverProcess.on('error', (error) => {
        console.error('Server process error:', error);
    });

    return port;
}

/**
 * Creates the main browser window and loads the application
 */
async function createWindow() {
    const port = await startServer();

    Menu.setApplicationMenu(null);

    const windowConfig = {
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        title: "EduPortfolio",
        autoHideMenuBar: true,
    };

    mainWindow = new BrowserWindow(windowConfig);

    setTimeout(() => {
        mainWindow.loadURL(`http://localhost:${port}/login.html`);
    }, SERVER_STARTUP_DELAY_MS);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Cleans up server process before application quits
 */
function cleanupServerProcess() {
    if (serverProcess) {
        serverProcess.kill();
    }
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        cleanupServerProcess();
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
