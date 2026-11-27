import http from "node:http";

const form = `<!doctype html><form><label>Lead <input name="lead"></label><button>Save</button></form>
<output></output><script>
const output = document.querySelector("output");
output.textContent = localStorage.getItem("lead") || "";
document.querySelector("form").onsubmit = (event) => {
  event.preventDefault();
  const lead = event.target.elements.lead.value;
  localStorage.setItem("lead", lead);
  document.cookie = "browser_fixture=present; Path=/";
  output.textContent = lead;
};
document.body.dataset.cookie = document.cookie;
</script>`;

const proxy = http.createServer((request, response) => {
  if (request.url === "http://workforce-browser.test/form") {
    response.writeHead(200, { "content-type": "text/html" }).end(form);
  } else {
    response.writeHead(403, { "content-type": "text/plain" }).end("Denied by the browser fixture proxy.");
  }
});
proxy.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
proxy.listen(8080, "0.0.0.0");
