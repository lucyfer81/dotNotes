import { createApp } from "./app-factory";

const app = createApp();

const worker: ExportedHandler<Env> & { request: typeof app.request } = {
	fetch: app.fetch.bind(app),
	request: app.request.bind(app),
};

export default worker;
