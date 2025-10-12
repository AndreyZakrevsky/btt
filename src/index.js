import { BinanceTrader } from './bot.js';
import 'dotenv/config';

const configUAH = {
    asset: process.env.ASSET,
    base: process.env.BASE,
    clearanceSell: process.env.CLEARANCE_SELL,
    clearanceBuy: process.env.CLEARANCE_BUY,
    tickInterval: process.env.INTERVAL,
    sellStepInUsdt: process.env.STEP,
    limitBase: process.env.LIMIT,
};

const uahTrade = new BinanceTrader(configUAH);
uahTrade.tick();
