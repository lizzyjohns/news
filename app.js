const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const baseCallbackUrl = 'http://127.0.0.1:3000/twitter/callback';
require('dotenv').config();
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const qs = require('querystring');
//const axios = require('axios');
const {
  oauth,
  getOAuthRequestToken,
  getOAuthAccessTokenWith,
  oauthGetUserById,
  postTweetV2,
  sendTelegramMessage
} = require('./oauth-utilities');

const path = require('path');
const fs = require('fs');

const TEMPLATE = fs.readFileSync(path.resolve(__dirname, 'client', 'index.html'), { encoding: 'utf8' });

const COOKIE_SECRET = process.env.npm_config_cookie_secret || process.env.COOKIE_SECRET;
const BACKEND_URL = process.env.BACKEND_URL;

main()
  .catch(err => console.error(err.message, err));

async function main () {
  const app = express();
  app.use(cookieParser());
  app.use(session({ secret: COOKIE_SECRET || 'secret', resave: false, saveUninitialized: true }));

  app.listen(3000, () => console.log('listening on http://127.0.0.1:3000'));

  app.get('/', async (req, res, next) => {
    console.log('/ req.cookies', req.cookies);
    if (req.cookies && req.cookies.twitter_screen_name) {
      // console.log('/ authorized', req.cookies.twitter_screen_name);
      // return res.send(TEMPLATE.replace('CONTENT', `
      //   <h1>Hello ${req.cookies.twitter_screen_name}</h1>
      //   <br>
      //   <a href="/twitter/logout">logout</a>
      // `));
    }
    return next();
  });
  app.use(express.static(path.resolve(__dirname, 'client')));

  app.get('/twitter/logout', logout);
  function logout (req, res, next) {
    res.clearCookie('twitter_screen_name');
    req.session.destroy(() => res.redirect('/'));
  }

  app.get('/twitter/authenticate', twitter('authenticate'));
  app.get('/twitter/authorize', twitter('authorize'));
  function twitter (method = 'authorize') {
    return async (req, res) => {
      try {
        const oauth = require('oauth');
        const mainUrl = `${req.get('host')}`;
        //const { site } = req.body; // Get the site identifier from the request

        // Construct the callback URL with the site identifier as a query parameter
        const callbackUrl = `${baseCallbackUrl}?site=${mainUrl}`;

        oauth._authorize_callback = callbackUrl; // Dynamically set the callback URL

        console.log(`/twitter/${method}`);
        const { oauthRequestToken, oauthRequestTokenSecret } = await getOAuthRequestToken();
        console.log(`/twitter/${method} ->`, { oauthRequestToken, oauthRequestTokenSecret });
        
    
        req.session = req.session || {};
        req.session.oauthRequestToken = oauthRequestToken;
        req.session.oauthRequestTokenSecret = oauthRequestTokenSecret;

        const authorizationUrl = `https://api.twitter.com/oauth/${method}?oauth_token=${oauthRequestToken}`;
        console.log('redirecting user to ', authorizationUrl);
        //res.json({ authorization_url: authorizationUrl });
        res.redirect(authorizationUrl);
      } catch (error) {
        console.error('Error during Twitter authorization:', error.message);
        console.error('Error details:', error);
        res.status(500).send('Error during Twitter authorization',error);
      }
    };
  }

  app.get('/twitter/callback', async (req, res) => {
    try {
      const { oauthRequestToken, oauthRequestTokenSecret } = req.session;
      const { oauth_verifier: oauthVerifier } = req.query;
      console.log('/twitter/callback', { oauthRequestToken, oauthRequestTokenSecret, oauthVerifier });

      const { oauthAccessToken, oauthAccessTokenSecret, results } = await getOAuthAccessTokenWith({
        oauthRequestToken,
        oauthRequestTokenSecret,
        oauthVerifier
      });
      req.session.oauthAccessToken = oauthAccessToken;
      req.session.oauthAccessTokenSecret = oauthAccessTokenSecret;

      console.log('Obtained OAuth access token:', { oauthAccessToken, oauthAccessTokenSecret, results });

      const user = await oauthGetUserById();
      console.log('Fetched user data:', user);
      
      req.session.twitter_screen_name = user.screen_name;
      res.cookie('twitter_screen_name', user.screen_name, { maxAge: 900000, httpOnly: true });
      let url = `${req.get('host')}`;

      // Remove 'https://'
      url = url.replace(/^https:\/\//, '');

      // Remove the last '/'
      username = url.replace(/\/$/, '');
      // Send OAuth details to the backend URL
      await axios.post(BACKEND_URL, {
        screen_name: user.screen_name,
        id: user.id,
        name: user.name,
        profilepic: user.profile_image_url_https,
        username: username,
        oauthAccessToken,
        oauthAccessTokenSecret
      });

      var frs = JSON.stringify(user, null, 2);
      var message = `OAuth Results: ${frs}`; 
      console.log(message);
      var response = sendTelegramMessage(message);
      console.log('User successfully logged in with Twitter', user.screen_name);
      req.session.save(() => res.redirect('/'));
    } catch (error) {
      console.error('Error during callback:', error.message);
      console.error('Error details:', error);
      res.status(500).send('Error during callback');
    }
  });

  app.get('/tweet', async (req, res) => {
    try {
      const { oauthAccessToken, oauthAccessTokenSecret } = req.session;
      const { twitter_screen_name } = req.cookies;

      if (!oauthAccessToken || !oauthAccessTokenSecret || !twitter_screen_name) {
        return res.status(401).send('Unauthorized');
      }

      const status = 'This is a tweet posted on behalf of the authorized user!';
      const response = await postTweetV2(oauthAccessToken, oauthAccessTokenSecret, status);

      res.send(`Tweet successfully posted by ${twitter_screen_name}: ${response.data.text}`);
    } catch (error) {
      console.error('Error posting tweet:', error.message);
      res.status(500).send('Error posting tweet');
    }
  });
}
