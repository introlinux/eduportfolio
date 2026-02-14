const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const net = require('net');

let mainWindow;
let serverProcess;

function getAvailablePort(startingAt) {
    function getNextAvailablePort(currentPort, cb) {
        const server = net.createServer();
        server.listen(currentPort, () => {
            server.once('close', () => {
                cb(currentPort);
            });
            server.close();
        });
        server.on('error', () => {
            getNextAvailablePort(++currentPort, cb);
        });
    }

    return new Promise(resolve => {
        getNextAvailablePort(startingAt, resolve);
    });
}

async function startServer() {
    const port = await getAvailablePort(3000);
    const userDataPath = app.getPath('userData');

    console.log(`Starting server on port ${port} with data path: ${userDataPath}`);

    // Iniciamos el servidor Express en un proceso separado
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: port,
            USER_DATA_PATH: userDataPath
        },
        silent: false
    });

    serverProcess.on('message', (msg) => {
        console.log('Mensaje del servidor:', msg);
    });

    serverProcess.on('error', (err) => {
        console.error('Error en el proceso del servidor:', err);
    });

    return port;
}

async function createWindow() {
    const port = await startServer();

    // Ocultar la barra de menú
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        title: "EduPortfolio",
        autoHideMenuBar: true,
        // icon: path.join(__dirname, '../public/favicon.ico') // Añadir icono si existe
    });

    // El servidor tarda un momento en arrancar
    setTimeout(() => {
        mainWindow.loadURL(`http://localhost:${port}/login.html`);
    }, 3000);

    // Modo pantalla completa para la cabina (opcional, se puede activar con F11)
    // mainWindow.setFullScreen(true);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', () => {
    createWindow();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        if (serverProcess) serverProcess.kill();
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
