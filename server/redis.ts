import Redis from "ioredis";
export const redis=new Redis(process.env.REDIS_URL??"redis://127.0.0.1:6379",{maxRetriesPerRequest:2,lazyConnect:true});
export async function withLock<T>(key:string,ttlMs:number,work:()=>Promise<T>){if(redis.status==="wait")await redis.connect();const token=crypto.randomUUID();const ok=await redis.set(`lock:${key}`,token,"PX",ttlMs,"NX");if(!ok)return null;try{return await work();}finally{await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",1,`lock:${key}`,token);}}
