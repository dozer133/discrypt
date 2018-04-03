var browser = browser || chrome;
var timer;

var mutationObserver = new MutationObserver(function(mutations) {

  for (var mutation of mutations)
  {
    if (mutation.target == undefined)
      continue;

    if ($('.edit-container-inner').is(':visible'))
    {
      // we're editing a message, decrypt the contents of the textarea
      decryptTextarea($('.edit-container-inner').find('textarea'));
    }
    else
    {
      // send all .markup elements for decryption
      var messages = mutation.target.querySelectorAll('.markup');
      sendToBackground(messages);
    }
  }
});


function sendMessage(data, callback)
{
  if (chrome == undefined)
  {
    var send = browser.runtime.sendMessage(data);
    send.then(callback, function(error) {

    });
  }
  else
  {
     browser.runtime.sendMessage(data, callback);
  }
}


function init()
{
  waitUntilExists('.messages', function() {

    // when switching server/channel the messages gets restored, decrypt them again

    $('div[class^="channels-"], .guilds-wrapper').on('click', function() {

      setTimeout(function() {
        mutationObserver.disconnect();
        $('.messages').trigger('change');
        sendToBackground(document.querySelectorAll('.markup'));

        setTimeout(function() {
          var scroller = document.querySelector('.messages.scroller');
          scroller.scrollTop = scroller.scrollHeight;
        }, 300);

        attachObserver();
      }, 200);

    });

    attachObserver();
    $('.messages').attr('dc-attached', true);

  });
}

// observe .messages element for new messages
function attachObserver()
{
  mutationObserver.observe(document.querySelector('.messages'), {
    childList: true,
    attributes: true,
    subtree: true,
    characterData: true
  });
}

function waitUntilExists(selector, callback)
{
  if ($(selector).length < 1)
  {
    clearTimeout(timer);
    timer = setTimeout(function() {
      waitUntilExists(selector, callback)
    }, 100);
  }
  else
  {
    if (typeof(callback) == 'function')
      callback();
  }
}

// for decrypting the textarea when editing a message
// unfortunately you cannot see the update until you switch channels
function decryptTextarea(element)
{

  if ($(element).length < 1)
    return;

  if ($(element).attr('data-dc-id') != undefined)
    return;

  if ($(element).val().substring(0, 5) == '$dcm$')
  {
    var elementId = Math.random();
    $(element).attr('data-dc-id', elementId);

    sendMessage({elementId: elementId, method: 'decrypt', message: $(element).val().slice(5) }, function(response) {
      if (response.message != undefined)
      {
        $('textarea[data-dc-id="' + response.elementId + '"]').val(response.message);
      }
    });
  }
}

// sends messages to background script for decryption
function sendToBackground(messages)
{

  if(messages.length < 1)
    return;

  for (var message of messages)
  {

    // the elements are a pain to keep track of, mark it with our own ID
    var elementId = Math.random();
    if ($(message).attr('data-dc-id') == undefined)
      $(message).attr('data-dc-id', elementId);

    // messages tend to show up more than once from the mutationObserver, sometimes decryption fails for some reason
    // if it passes 10, skip it

    if ($(message).data('dc-process-count') == undefined)
      $(message).data('dc-process-count', 1);
    else
      $(message).data('dc-process-count', parseInt($(message).data('dc-process-count')) + 1);

    if (parseInt($(message).data('dc-process-count')) > 10)
      continue;

    var messageText = $(message).text();
    var ircStyle = false;

    // check if the user has 'irc style appearance' enabled
    if ($(message).children().length == 3)
    {
      ircStyle = true;
      $(message).attr('data-dc-irc', true);

      messageText = $(message).children('span:eq(2)').text();
    }

    var padLock = '<img src="' + browser.extension.getURL('img/icon16.png') + '" title="Discrypt message" alt="[Discrypt message]"> ';

    // an encrypted message
    if (messageText.substring(0, 5) == '$dcm$')
    {

      if (ircStyle)
        $(message).children('span:eq(2)').html(padLock + 'Decrypting..');
      else
        $(message).html(padLock + 'Decrypting..');

      // send message to background script which has the channel keys for decryption

      sendMessage({elementId: elementId, method: 'decrypt', message: messageText.slice(5) }, function(response) {
        if (response.message != null)
        {

          // remove html from message
          response.message = $($.parseHTML(response.message)).text();

          response.message = makeLinksClickable(response.message);

          response.message = padLock + response.message;

          if ($('div[data-dc-id="' + response.elementId + '"]').attr('data-dc-irc') != undefined)
          {
            $('div[data-dc-id="' + response.elementId + '"]').children('span:eq(2)').html(response.message).show();
          }
          else
          {
            $('div[data-dc-id="' + response.elementId + '"]').html(response.message).show();
          }
        }
        else
        {
          if ($('div[data-dc-id="' + response.elementId + '"]').attr('data-dc-irc') != undefined)
          {
            $('div[data-dc-id="' + response.elementId + '"]').children('span:eq(2)').html(padLock + 'Could not decrypt message').show();
          }
          else
          {
            $('div[data-dc-id="' + response.elementId + '"]').html(padLock + 'Could not decrypt message').show();
          }
        }
      });
    }

    // a discrypt command
    if (messageText.substring(0, 5) == '$dcc$') {

      var payload = '';

      try {
        payload = JSON.parse(messageText.slice(5));
      }
      catch (e) {
          return false;
      }

      switch(payload.cmd)
      {
        // someone requsted a channel key
        case 'requestKey':
          sendMessage({elementId: elementId, method: 'addrequest', publicKeyId: payload.publicKeyId, publicKey: payload.publicKey }, function(response) {
            $('div[data-dc-id="' + response.elementId + '"]').html(padLock + '<b>Discrypt Key Request</b><br>\
            I sent a channel key request. If you have the key and wish to send it to me, send this command to the chat:<br>\
            <b>.sendkey ' + payload.publicKeyId + '</b>');
          });
        break;

        // someone sent a channel key
        case 'keySent':
        sendMessage({elementId: elementId, method: 'receiveKey', publicKeyId: payload.publicKeyId, encryptedChannelKey: payload.encryptedChannelKey }, function(response) {
          var statusText = padLock + '<b>Discrypt Key Request</b><br>\
            Channel key was sent, but you could not decrypt it.';

          if (response.state == 'success')
            statusText = padLock + '<b>Discrypt Key Request</b><br>\
            Channel key was sent and you decrypted it successfully.';

          if (response.state == 'alreadyHaveKey')
            statusText = padLock + '<b>Discrypt Key Request</b><br>\
            Channel key was sent, but you already have a key stored for this channel.';

          if (response.state == 'invalidPublicKeyId')
            statusText = padLock + '<b>Discrypt Key Request</b><br>\
            Channel key was sent, but it was not to you.';

          $('div[data-dc-id="' + response.elementId + '"]').html(statusText);

        });
        break;
      }


    }

  };
}

function makeLinksClickable(message)
{
  var urlRegex = /(https?:\/\/[^\s]+)/g;
  return message.replace(urlRegex, function(url) {
      return '<a target="_blank" href="' + url + '">' + url + '</a>';
  })
}

init();

document.onload = function() {
  init();
}
