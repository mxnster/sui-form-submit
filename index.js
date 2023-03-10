import HttpsProxyAgent from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from "axios";
import consoleStamp from 'console-stamp';
import randUserAgent from 'rand-user-agent';
import { Ed25519Keypair, JsonRpcProvider, RawSigner } from '@mysten/sui.js';
import fs from 'fs';
import { config } from './config.js'

consoleStamp(console, { format: ':date(HH:MM:ss)' });

const provider = new JsonRpcProvider('https://rpc-ws-testnet-w2.suiscan.xyz/');
const timeout = ms => new Promise(res => setTimeout(res, ms))
const parseFile = fileName => fs.readFileSync(fileName, "utf8").split('\n').map(str => str.trim()).filter(str => str.length > 10);
const generateRandomAmount = (min, max) => Math.random() * (max - min) + min;
const retriesMap = new Map();
function mnemonicToAddress(mnemonic) {
    const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
    return `0x${keypair.getPublicKey().toSuiAddress()}`;
};


async function submitForm(address, name, mail, proxy) {
    const axiosInstance = config.httpProxy ? axios.create({ httpsAgent: new HttpsProxyAgent(proxy) }) : axios.create({ httpsAgent: new SocksProxyAgent(proxy) })
    console.log(`Кошелек: ${address}`)
    console.log(`Прокси (${config.httpProxy ? 'https' : 'socks5'}): ${proxy.split('@')[1]}`)
    console.log(`Имя: ${name}`)
    console.log(`Почта: ${mail}`)

    let response = await axiosInstance(`https://apps-backend.sui.io/frenemies`, {
        method: "POST",
        headers: {
            'authority': 'apps-backend.sui.io',
            'accept': '*/*',
            'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'content-type': 'application/json',
            'dnt': '1',
            'origin': 'https://frenemies.sui.io',
            'referer': 'https://frenemies.sui.io/',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': randUserAgent("desktop")
        },
        data: {
            'address': address,
            'name': name,
            'email': mail
        }
    }).catch(err => console.error(err?.response?.data || err?.response || err));

    if (response?.data) {
        console.log(`Отправил форму`);
        return response?.data?.bytes
    }
}

async function getPlayerCard(address) {
    let retries = 0;
    try {
        while (retries < 10) {
            let objects = await provider.getObjectsOwnedByAddress(address);
            let card = objects.find(i => i.type.includes(`0x436dfcc34d299f3ad41a3429da4b66f2e627db84::frenemies::Scorecard`))

            if (card) {
                let info = await provider.getObject(card.objectId);

                return {
                    objectId: card.objectId,
                    participation: info.details.data.fields.participation,
                    score: info.details.data.fields.score,
                    ...info.details.data.fields.assignment.fields,
                    ...info.details.data.fields.name.fields
                }
            }
            retries++;
            await timeout(5000)
        }
    } catch (e) { console.log('Не удалось получить карточку игрока после 10 попыток'); }
}

async function approveForm(signer, bytes, address) {
    let retries = retriesMap.get(address);
    try {
        if (retries < 6) {
            console.log(`Аппруваю форму ${retries > 1 ? `попытка ${retries}` : ''}`);

            await signer.executeMoveCall({
                packageObjectId: '0x7829fea9bbd3aecdc7721465789c5431bdaf9436',
                module: 'noop',
                function: 'noop_w_metadata',
                typeArguments: [],
                arguments: [bytes],
                gasBudget: Number(generateRandomAmount(1500, 3000).toFixed(0))
            }, "WaitForEffectsCert");
        }
    } catch (err) {
        console.log('Не удалось аппрувнуть форму');
        retriesMap.set(address, retries + 1)
        console.log(err.message);
        await timeout(5000)
        await approveForm(signer, bytes)
    }
}

(async () => {
    let accounts = parseFile('data.txt');

    for (let i = 0; i < accounts.length; i++) {
        const [mnemonic, name, mail, proxy] = accounts[i].split(';');
        const [ip, port, login, password] = proxy.trim().split(":");
        const proxyString = config.httpProxy ? `http://${login}:${password}@${ip}:${port}` : `socks5://${login}:${password}@${ip}:${port}`;
        const address = mnemonicToAddress(mnemonic);
        const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
        const signer = new RawSigner(keypair, provider);
        retriesMap.set(address, 1)

        let card = await getPlayerCard(address)
        console.log(`Кол-во поинтов: ${card.score}`);

        if (card.score > 0) {
            const bytes = await submitForm(address, name.trim(), mail.trim(), proxyString)
            await timeout(5000)

            if (bytes) {
                await approveForm(signer, bytes, address)
                await timeout(5000)
                console.log('-'.repeat(60));
            }
        } else console.log(`Не отправляю форму :(`);
    }
})()