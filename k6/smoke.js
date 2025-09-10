import http from "k6/http";
import { sleep, check } from "k6";

export const options = { vus: 1, duration: "30s" };

export default function () {
  const res = http.get(`${__ENV.BASE_URL || "http://localhost:8080"}/health`);
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
