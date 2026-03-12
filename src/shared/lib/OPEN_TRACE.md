# Open Trace

`openTrace` is a local note-open tracer used for latency diagnosis.

It is intentionally lightweight:
- no OpenTelemetry dependency
- no exporter or collector
- no app-wide telemetry abstraction

## How To Read A Trace
- `open started`: root trace created for one note-open workflow.
- `open.<phase> started` / `done` / `blocked` / `error`: child spans with local durations.
- `open summary`: aggregated buckets for the workflow.
- `open done` / `blocked` / `error`: final outcome for the workflow.

## Naming Rules
- Root phases use `open.` prefixes, for example `open.request`.
- IPC spans include the invoked command name, for example `open.ipc.read_text_file`.
- Summary buckets stay in stable snake_case so regressions are easy to compare across runs.
