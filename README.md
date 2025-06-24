# raw-printer-mock

Simple printer mock to test PJL spoolers.

```
$ npm install raw-printer-mock
```

```JavaScript
import { RawPrinter } from 'raw-printer-mock';

const rawPrinter = new RawPrinter();
...
rawPrinter.stop();
```

```
$yarn rawprinter --help
Simple raw printer server mock.

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
    Return status 204 on success, 404 if not found.
```
