"use strict";

const request = require('request'),
      Socket = require('./socket'),
      fs = require('fs');

class RapidAPI {

    /**
     * Returns the base URL for block calls
     * @returns {string} Base URL for block calls
     */
    static getBaseURL() {
        return "https://rapidapi.io/connect";
    }

    /**
     * Build a URL for a block call
     * @param pack Package where the block is
     * @param block Block to be called
     * @returns {string} Generated URL
     */
    static blockURLBuilder(pack, block) {
        return `${RapidAPI.getBaseURL()}/${pack}/${block}`;
    }

    /**
    * Returns the base URL for webhook event callbacks
    * @return {string} Base URL for webhook event callbacks
    */
    static callbackBaseURL() {
        return "http://webhooks.imrapid.io";
    }

    /**
     * Returns the base URL for websocket connection
     * @return {string} Base URL for websocket connection
     */
    static websocketBaseURL() {
        return "ws://webhooks.imrapid.io";
    }

    /**
     * Creates a new RapidAPI Connect instance
     * @param project Name of the project you are working with
     * @param key API key for the project
     */
    constructor (project, key) {
        this.project = project;
        this.key = key;
    }

    /**
     * Call a block
     * @param pack Package of the block
     * @param block Name of the block
     * @param args Arguments to send to the block (JSON)
     */
    call (pack, block, args) {
        //Will hold all the callbacks user adds using .on()
        let __callbacks = {};

        //Call the block
        request({
            method: 'POST',
            uri: RapidAPI.blockURLBuilder(pack, block),
            headers: {
                'User-Agent': 'RapidAPIConnect_NodeJS',
                'Content-Type' : 'multipart/form-data'
            },
            auth: {
                'user': this.project,
                'pass': this.key,
                'sendImmediately': true
            },
            formData: args || {}
        }, (error, response, body) => {
            try {
                if (typeof body != 'object')
                    body = JSON.parse(body);
            } catch (e) {
                error = e;
            }
            if (error || response.statusCode != 200 || !(body.hasOwnProperty('outcome'))) {
                if (__callbacks.hasOwnProperty('error')) {
                    __callbacks['error'](body);
                }
            } else {
                if (__callbacks.hasOwnProperty(body.outcome)) {
                    __callbacks[body.outcome](body.payload);
                }
            }
        });

        //Return object that let's user add callback using .on()
        var r = {
            on: (e, cb) => {
                if (typeof cb == 'function' && typeof e == 'string') {
                    __callbacks[e] = cb;
                } else {
                    throw "Invalid event key and callback. Event key should be a string and callback should be a function."
                }
                return r;
            }
        };
        return r;
    }

    /**
     * Listen for webhook events
     * @param pack Package of the event
     * @param event Name of the event
     * @param callbacks Callback functions to call on message and on connection close
     */
    listen (pack, event, params) {
        const __callbacks = {};
        const __eventCallback = (event) => __callbacks[event] || function () {};

        const user_id = `${pack}.${event}_${this.project}:${this.key}`;
        request({
            uri: `${RapidAPI.callbackBaseURL()}/api/get_token?user_id=${user_id}`,
            method: 'GET',
            headers: {
                "Content-Type": "application/json"
            },
            auth: {
                'user': this.project,
                'pass': this.key,
                'sendImmediately': true
            }
        }, (error, response, body) => {
            const { token } = JSON.parse(body);
            const sock_url = `${RapidAPI.websocketBaseURL()}/socket/websocket?token=${token}`;
            const socket = new Socket.Socket(sock_url, {
                params: {token}
            });
            socket.connect();
            const channel = socket.channel(`users_socket:${user_id}`, params);
            channel.join()
                   .receive('ok', msg => { __eventCallback('join')(msg); })
                   .receive('error', reason => { __eventCallback('error')(reason); })
                   .receive('timeout', () => { __eventCallback('timeout'); });

            channel.on('new_msg', msg => { __eventCallback('message')(msg.body); });
            channel.onError(() => __eventCallback('error'));
            channel.onClose(() => __eventCallback('close'));
        });
        const r = {
            on: (event, func) => {
                if (typeof func !== 'function') throw "Callback must be a function.";
                if (typeof event !== 'string') throw "Event must be a string.";
                __callbacks[event] = func;
                return r;
            }
        };
        return r;
    }
}

module.exports = RapidAPI;
