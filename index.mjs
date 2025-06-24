import net from 'node:net';
import cliArgs from 'command-line-parser';
import express from 'express';
import {v4 as uuid4} from 'uuid';	


function printHelp() {
	console.log(`Simple raw printer server mock.

Listens for raw print data on a specified port and provide API to retrieve the printed jobs info.

Usage: rawprinter [OPTIONS]

Options:
  --host HOST     Host to listen on (default: 0.0.0.0)
  --port PORT     Port to listen on (default: 9100)
  --api-host HOST Host for the API server (default: 0.0.0.0)
  --api-port PORT Port for the API server (default: 8080)
  --help          Show this help message

API:
    GET /jobs

    Returns a list of printed jobs in JSON. 
    Response format:
      [{"id": "<uuid4>", "data": "<base64-encoded-payload>"}, ...]

  DELETE /jobs

    Clears the list of printed jobs.
    Return status 204 on success.
	
  GET /jobs/:id

    Returns the details of a specific printed job by ID.
    If the job is not found, returns status 404.
    Response format:
      binary data of the printed job payload.
	
  DELETE /jobs/:id
	
    Deletes a specific printed job by ID.
    Return status 204 on success, 404 if not found.`);
}


export function startPrinter(host='0.0.0.0', port=9100, api_host='0.0.0.0', api_port=8080) {
    const printedJobs = new Map();
    const sockets = new Set();
    const printerServer = net.createServer((socket) => {
      console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
      const id = uuid4();
      sockets.add(socket);

      socket.on('data', (data) => {
          data = String(data);
          console.log(`Received data ${id}: ${data}`);

          if (printedJobs.has(id)) {
              data = printedJobs.get(id).raw + data;
          }
          console.log(Array.from(printedJobs.entries()));

          const rv = parsePJL(data);
          console.log(`Parsed job: ${JSON.stringify(rv)}`);
          if (rv.isAnyStatusFlag() && rv.endOfJob) {
              socket.write(`@PJL USTATUS JOB\r\nSTART\r\nNAME="${rv.jobName}"\r\n\f@PJL USTATUS JOB\r\nEND\r\nNAME="${rv.jobName}"\r\nPAGES=1\f`);
          }

          printedJobs.set(id, {raw: data, parsed: rv});
      });

      socket.on('close', (hadError) => {
          console.log(`Client disconnected, hadError: ${hadError}`);
      });

      socket.on('error', (err) => {
          console.error('Socket error:', err);
      });
    });

    printerServer.on('error', (err) => {
        console.error(err);
    });

    printerServer.listen({host, port}, () => {
        console.log(`Listening endpoint ${host}:${port} for raw print data...`);
    });

    const expressApp = express();

    expressApp.use(express.json());
    expressApp.use(express.urlencoded({ extended: true }));
    expressApp.get('/jobs', (req, res) => {
        const entries = Array.from(printedJobs.entries());
        const jobs = entries.map(item => {
            return {
                id: item[0],
                raw: Buffer.from(item[1].raw).toString('base64'),
                parsed: item[1].parsed
            };
        });
        res.json(jobs);
    });

    expressApp.delete('/jobs', (req, res) => {
        printedJobs.clear();
        console.log('DELETE /jobs', Array.from(printedJobs.entries()));
        res.status(204).send();
    });

    expressApp.get('/jobs/:id', (req, res) => {
        const job = printedJobs.get(req.params.id);
        if (!job) {
            res.status(404).send('Job not found');
            return;
        } 

        res.send(Buffer.from(job.raw, 'binary'));
    });

    expressApp.delete('/jobs/:id', (req, res) => {
        const job = printedJobs.get(req.params.id);
        if (!job) {
            res.status(404).send('Job not found');
            return;            
        }

        printedJobs.delete(req.params.id);
        res.status(204).send();
    });

    const expressServer = expressApp.listen(api_port, api_host, (err) => {
        if (err) {
            console.log(err);
            return;
        }
        console.log(`Listening endpoint ${api_host}:${api_port} for http api...`);
    });

    return [sockets, printedJobs, printerServer, expressApp, expressServer];
}


export class RawPrinter {
    constructor(host='0.0.0.0', port=9100, api_host='0.0.0.0', api_port=8080) {
        const [sockets, printedJobs, printerServer, expressApp, expressServer] = startPrinter(host, port, api_host, api_port);
        this.sockets = sockets;
        this.printedJobs = printedJobs;
        this.printerServer = printerServer;
        this.expressApp = expressApp;
        this.expressServer = expressServer;
    }

    stop() {
        console.log('Stopping raw printer');
        this.printerServer.close();
        this.expressServer.close();
        this.expressServer.closeAllConnections();
        this.sockets.forEach(socket => socket.destroy());
        this.sockets.clear();
    }
}


function main() {
    const {host='0.0.0.0', port=9100, api_host='0.0.0.0', api_port=8080, help=false} = cliArgs();
    if (help) {
        printHelp();
        return;
    }

    try {
        startPrinter(host, port, api_host, api_port);
    } catch (e) {
        console.error(e);
        return 1;
    }
}


function parsePJL(pjlString) {
    const result = {
        data: null,
        jobName: null,
        statusFlags: {
            device: false,
            page: false,
            job: false
        },
        endOfJob: false,
        isAnyStatusFlag() {
            return this.statusFlags.device || this.statusFlags.page || this.statusFlags.job;
        }
    };

    const pjlSignature = '\u001b%-12345X';
    const lines = pjlString.replaceAll(pjlSignature, '').replaceAll('\r', '')
                           .split('\n').map(s => s.trim()).filter(s => s != '');
    
    console.log(lines);
    
    for (let line of lines) {
        if (line.startsWith('@PJL JOB NAME=')) {
            const match = line.match(/@PJL JOB NAME="([^"]+)"/);
            if (match) {
                result.jobName = match[1];
            }
        } 
        else if (line.startsWith('@PJL USTATUS')) {
            if (line === '@PJL USTATUSOFF') {
                result.statusFlags.device = false;
                result.statusFlags.page = false;
                result.statusFlags.job = false;
            } else {
                if (line.includes('DEVICE=ON')) result.statusFlags.device = true;
                if (line.includes('PAGE=ON')) result.statusFlags.page = true;
                if (line.includes('JOB=ON')) result.statusFlags.job = true;
            }
        } else if (line.startsWith('@PJL EOJ NAME')) {
            result.endOfJob = true;
        } else if (!line.startsWith('@PJL')) {
            const i = line.indexOf('@PJL');
            if (i != -1) {
                line = line.substring(0, i);
            }
            console.log(line, i);
            result.data = line;
        }
    }

    return result;
}


if (process.argv[1] === import.meta.filename) {
    main();
}
