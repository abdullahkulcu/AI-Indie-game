import{createCipheriv,createDecipheriv,randomBytes}from"node:crypto";
export type EncryptedKey={ciphertext:Buffer;iv:Buffer;tag:Buffer;keyVersion:string};
function masterKey(){const value=process.env.BYOK_MASTER_KEY;if(!value)throw new Error("BYOK_MASTER_KEY gerekli");const key=Buffer.from(value,"base64");if(key.length!==32)throw new Error("BYOK_MASTER_KEY 32 bayt base64 olmalı");return key;}
export function encryptApiKey(plaintext:string):EncryptedKey{const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",masterKey(),iv);const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);return{ciphertext,iv,tag:cipher.getAuthTag(),keyVersion:process.env.BYOK_KEY_VERSION??"local-v1"};}
export function decryptApiKey(value:EncryptedKey){const decipher=createDecipheriv("aes-256-gcm",masterKey(),value.iv);decipher.setAuthTag(value.tag);return Buffer.concat([decipher.update(value.ciphertext),decipher.final()]).toString("utf8");}
