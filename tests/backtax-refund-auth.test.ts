import { expect, it } from 'vitest';
import express from 'express';
import { backTaxRefundRouter } from '../server/backTaxRefund';
it('audit and execution both require existing admin bearer; player sessions do not authorize refunds', async () => {
  const app=express();app.use(backTaxRefundRouter());const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const addr=server.address() as {port:number};const base=`http://127.0.0.1:${addr.port}`;
  try {
    for(const [path,method] of [['audit','GET'],['refund-one','POST'],['gate','POST']]) {
      const r=await fetch(`${base}/api/admin/backtax-refunds/${path}`,{method,headers:{'x-relay-session':'ordinary-player-session'}});
      expect(r.status).toBe(401);expect(await r.json()).toEqual({ok:false,error:'Unauthorized.'});
    }
  } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
