// keyscrow.<account>.workers.dev: the KeyScrow name in the URL. Forwards every request unchanged to the app Worker
// (keyescrow-web) through a service binding, so there is one app, one Durable Object state and one set of secrets.
// (A plain fetch() to another *.workers.dev of the same account is refused by Cloudflare; a service binding is not.)
export default {
  fetch(request, env) {
    return env.APP.fetch(request);
  },
};
