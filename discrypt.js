var browser = browser || chrome;

function discrypt() {

  var currentServer = {
    id: ''
  };

  var currentChannel = {
    id: '',
    keys: {
      publicKey: '',
      privateKey: ''
    }
  };

  var headers = {}, currentUrl;

  var settings = {
    keys: {},
    publicKey: "",
    privateKey: ""
  }

  var blocking = false;

  var pendingRequests = {};


  var getRandomValues = function(length) {

    length = length / 10;

    var array = new Uint32Array(length);
    crypto.getRandomValues(array);

    return array.join('');
  }

  var generatePrivateKey = function() {
    var passphrase = getRandomValues(256);

    return cryptico.generateRSAKey(passphrase, 1024);
  }

  var generateKeyPair = function() {
    var rsaKey = generatePrivateKey();

    var privateKey = cryptico.privateKeyString(rsaKey);
    var publicKey = cryptico.publicKeyString(rsaKey);

    return {
      'privateKey': privateKey,
      'publicKey': publicKey
    };
  }

  var log = function(message) {
    console.log(message);
  }

  var setCurrentServer = function() {

      if (currentUrl == null)
        return;

      var urlSplit = currentUrl.split('/');

      currentServer.id = urlSplit[4];
      currentChannel.id = urlSplit[5];

      currentChannel.keys = {
        publicKey: '',
        privateKey: '',
      }

      if (currentChannel.id in settings.keys)
      {
        currentChannel.keys = settings.keys[currentChannel.id];
      }
  }

  this.setCurrentUrl = function(tabs) {
    for (let tab of tabs)
    {
      currentUrl = tab.url;
    }

    setCurrentServer();
  }

  this.init = function() {
    log('init')

    if (chrome == undefined)
    {
      var querying = browser.tabs.query({url: "*://discordapp.com/*"});
      querying.then(discrypt.setCurrentUrl, function(error) {
        log('error setting current url ' + error)
      });
    }
    else
    {
      browser.tabs.query({url: "*://discordapp.com/*"}, function(details) {
        discrypt.setCurrentUrl(details);
      });
    }
    getStorage(function() {
      if (settings.publicKey.length < 1 && settings.privateKey.length < 1)
      {
        var keyPair = generateKeyPair();
        settings.publicKey = keyPair.publicKey;
        settings.privateKey = keyPair.privateKey;

        setStorage();
      }

      bindEvents();

    });
  }

  var bindEvents = function() {
    browser.webRequest.onBeforeSendHeaders.addListener(
      function(details) {
        discrypt.setRequestHeaders(details);
      },
      {urls: ["*://discordapp.com/*"]},
      ["blocking", "requestHeaders"]
    );

    browser.webRequest.onBeforeRequest.addListener(
      function(details) {
        return discrypt.interceptRequest(details);
      },
      {urls: ["*://discordapp.com/api/v6/channels/*/messages*"]},
      ["blocking", "requestBody"]
    );

    browser.tabs.onUpdated.addListener(function(tabId, changeInfo, tabInfo) {
      if (changeInfo.url != null) {
        currentUrl = changeInfo.url;

        setCurrentServer();
      }
    });

    browser.runtime.onMessage.addListener(discrypt.handleMessage);
  }


  this.handleMessage = function (data, sender, sendResponse) {

    switch(data.method)
    {
      case 'decrypt':

        var decrypted = decryptMessage(data.message);

        sendResponse({
          elementId: data.elementId,
          method: 'messageDecrypted',
          message: decrypted
        });

      break;

      case 'addrequest':

        log('added request for ' + data.publicKeyId)

        pendingRequests[data.publicKeyId] = data.publicKey;

        sendResponse({
          elementId: data.elementId,
          method: 'addrequest',
        });

      break;

      case 'receiveKey':

        if (currentChannel.id in settings.keys)
        {
          if (settings.keys[currentChannel.id].publicKey.length > 0 && settings.keys[currentChannel.id].privateKey.length > 0)
          {
            sendResponse({
              elementId: data.elementId,
              method: 'receiveKey',
              state: 'alreadyHaveKey'
            });
            return;
          }
        }

        if (data.publicKeyId == cryptico.publicKeyID(settings.publicKey))
        {
          var decrypted = cryptico.decrypt(data.encryptedChannelKey, cryptico.privateKeyFromString(settings.privateKey));

          if (decrypted.status != 'success')
          {
            sendResponse({
              elementId: data.elementId,
              method: 'receiveKey',
              state: 'failed'
            });
            return;
          }

          var privateKeyString = cryptico.privateKeyFromString(decrypted.plaintext);

          settings.keys[currentChannel.id] = {
            publicKey: cryptico.publicKeyString(privateKeyString),
            privateKey: cryptico.privateKeyString(privateKeyString)
          }

          setCurrentServer();
          setStorage();

          sendResponse({
            elementId: data.elementId,
            method: 'receiveKey',
            publicKeyId: data.publicKeyId,
            state: 'success'
          });
        }
        else
        {
          sendResponse({
            elementId: data.elementId,
            method: 'receiveKey',
            publicKeyId: data.publicKeyId,
            state: 'invalidPublicKeyId'
          });
        }
      break;

      case 'requestEncryptedDM':
        if (currentServer.id != '@me')
          sendResponse({
            elementId: data.elementId,
            method: 'requestEncryptedDM',
            state: 'fail'
          });

        if (data.publicKeyId == cryptico.publicKeyID(settings.publicKey))
          sendResponse({
            elementId: data.elementId,
            method: 'requestEncryptedDM',
            state: 'yourOwn'
          });

        if (!(currentServer.id in settings.keys))
        {
          settings.keys[currentChannel.id] = data.publicKey;

          setStorage();

          sendResponse({
            elementId: data.elementId,
            method: 'requestEncryptedDM',
            state: 'success'
          });
        }
        else
        {
          sendResponse({
            elementId: data.elementId,
            method: 'requestEncryptedDM',
            state: 'alreadyAdded'
          });
        }
      break;
    }
  }

  var decryptMessage = function(message) {

    setCurrentServer();

    if (currentServer.id == '@me' && currentChannel.id in settings.keys)
    {
      currentChannel.keys.privateKey = settings.privateKey;
    }

    if (currentChannel.keys.privateKey.length < 1)
    {
      log('channel has no privatekey')
      return null;
    }

    var privateKey = cryptico.privateKeyFromString(currentChannel.keys.privateKey);

    var decrypted = cryptico.decrypt(message, privateKey);

    if (decrypted.status != 'success' || decrypted.signature != 'verified')
    {
      return null;
    }

    return decrypted.plaintext;
  }



  this.setRequestHeaders = function(details) {

    for (i = 0; i < details.requestHeaders.length; i++)
    {
      headers[details.requestHeaders[i].name] = details.requestHeaders[i].value;
    }

    return details;
  }

  var send = function(target, details) {

    blocking = true;

    $.ajax(target, {
      method: details.method,
      contentType: 'application/json',
      dataType: 'json',
      headers: {
        'Authorization': headers['Authorization'],
        'X-Super-Properties': headers['X-Super-Properties'],
      },
      data: details.payload,
      error: function(jqxhr, textStatus, error) {
        log(jqxhr.responseText)
      },
      success: function(response, status, jqxhr) {

        blocking = false;

        if (typeof(settings.callback) == 'function')
          settings.callback({
            response: response,
            status: status
          });

      }
     });
  }

  this.fromBase64 = function(string)
  {
    var result = null;

    try {
      result = atob(string)
    } catch (e) {
      log('Error converting from base64: ' + e)
    }

    return result;
  }

  this.interceptRequest = function(details) {

    // don't intercept our own request
    if (blocking)
    {
      return {};
    }

    // intercept only POST and PATCH requests
    if (details.method != 'POST' && details.method != 'PATCH')
      return {};

    // check if we have the requestbody
    if ( !('requestBody' in details))
      return {};

    var decoder = new TextDecoder("utf-8");
    var encoder = new TextEncoder();

    // decode payload
    var payload = decoder.decode(details.requestBody.raw[0].bytes, {stream: true});
    payload = JSON.parse(payload);

    // check if the payload has content
    if ( !('content' in payload) || payload.content == undefined)
      return {};

    // is this a command?
    if (payload.content.substring(0, 1) == '.')
    {
      var contentSplit = payload.content.split(' ');

      handleCommand(contentSplit[0], contentSplit.splice(1), details, payload);

      return { cancel: true }
    }

    setCurrentServer();

    if (currentServer.id == '@me' && currentChannel.keys.publicKey.length > 1)
    {
      currentChannel.keys.privateKey = settings.privateKey;
    }

    // check if we have any keys for the current channel
    if (currentChannel.keys.publicKey.length < 1 || currentChannel.keys.privateKey.length < 1)
      return {};


    // check if we have stored any request headers, we must have the Authorization header
    // if we don't have it, cancel the request and return
    if (Object.keys(headers).length < 1 || !('Authorization' in headers))
    {
      log('No headers present')
      return { cancel: true }
    }

    // don't intercept when running interceptRequest for this request we're about to make
    blocking = true;

    var encrypted = null;

    // encrypt the message
    try {
      encrypted = cryptico.encrypt(payload.content, currentChannel.keys.publicKey, cryptico.privateKeyFromString(currentChannel.keys.privateKey));

      if (encrypted.status != 'success')
      {
        log('Encrypt error')
        return { cancel: true }
      }
   } catch (e) {
      log('Encrypt error')
      return { cancel: true }
    }

    payload.content = '$dcm$' + encrypted.cipher;

    payload = JSON.stringify(payload);

    // send encrypted message
    send(details.url, {
      method: details.method,
      referer: details.originUrl,
      payload: payload
    });

    // cancel the original request
    return { cancel: true }
  }

  var handleCommand = function(command, parameters, originalRequest, originalPayload) {

    log('handleCommand ' + command)

    switch (command)
    {
        case '.createkey':
          var keyPair = generateKeyPair();

          var destructKey = generateKeyPair();

          settings.keys[currentChannel.id] = keyPair;

          setCurrentServer();

          setStorage();

        break;

        case '.deletekey':
          delete settings.keys[currentChannel.id];

          setCurrentServer();

          setStorage();
        break;

        case '.requestkey':

          var payload = {
            cmd: 'requestKey',
            publicKeyId: cryptico.publicKeyID(settings.publicKey),
            publicKey: settings.publicKey
          };

          originalPayload.content = '$dcc$' + JSON.stringify(payload);

          send(originalRequest.url, {
            method: 'POST',
            payload: JSON.stringify(originalPayload)
          });

        break;

        case '.dm':
          if (currentServer.id != '@me')
            return;

            var payload = {
                cmd: 'requestEncryptedDM',
                publicKeyId: cryptico.publicKeyID(settings.publicKey),
                publicKey: settings.publicKey
              };

            originalPayload.content = '$dcc$' + JSON.stringify(payload);

            send(originalRequest.url, {
              method: 'POST',
              payload: JSON.stringify(originalPayload)
            });


        break;

        case '.sendkey':

          if ( !(parameters[0] in pendingRequests))
          {
            log (parameters[0] + ' not in pendingRequests')

            return;
          }

          var encrypted = cryptico.encrypt(currentChannel.keys.privateKey, pendingRequests[parameters[0]]);

          if (encrypted.status != 'success')
          {
            log ('decryption of channelkey failed')
            return;
          }

          delete pendingRequests[parameters[0]];

          var payload = {
            cmd: 'keySent',
            publicKeyId: parameters[0],
            encryptedChannelKey: encrypted.cipher
          };

          originalPayload.content = '$dcc$' + JSON.stringify(payload);

          send(originalRequest.url, {
            method: 'POST',
            payload: JSON.stringify(originalPayload)
          });

        break;

        case '.pt':
        case '.plaintext':

          originalPayload.content = parameters.join(' ');

          send(originalRequest.url, {
            method: 'POST',
            payload: JSON.stringify(originalPayload)
          });
        break;
    }
  }

  var getStorage = function(callback) {
    chrome.storage.local.get(settings, function(items) {
      settings = items;

      if (typeof(callback) == 'function')
        callback();
    });
  }

  var setStorage = function(callback) {
    chrome.storage.local.set(settings, function() {
      if (typeof(callback) == 'function')
        callback();
    });
  }



};


(function(c){
    var parametersBigint = ["n", "d", "p", "q", "dmp1", "dmq1", "coeff"];

    c.privateKeyString = function(rsakey) {
        var keyObj = {};

        parametersBigint.forEach(function(parameter){
            keyObj[parameter] = c.b16to64(rsakey[parameter].toString(16));
        });

        try {
          keyObj = JSON.stringify(keyObj);
        } catch(err) {
          log('Error when parsing private key string: ' + err);

          return;
        }

        // e is 3 implicitly
        return btoa(keyObj);
    }
    c.privateKeyFromString = function(string) {

        if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/g.test(string))
        {
          string = discrypt.fromBase64(string);
          if (string == null)
            return;
        }

        var keyObj = {};

        try {
          keyObj = JSON.parse(string);
        } catch (err) {
          log('Error when parsing private key string: ' + err);

          return;
        }

        var rsa = new RSAKey();

        parametersBigint.forEach(function(parameter){
            rsa[parameter] = parseBigInt(c.b64to16(keyObj[parameter].split("|")[0]), 16);
        });

        rsa.e = parseInt("03", 16);

        return rsa;
    }
})(cryptico)

console.log('loaded')

var discrypt = new discrypt();
discrypt.init();
