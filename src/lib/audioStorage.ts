const DB_NAME = "rama_audio";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE_NAME);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Store an audio blob in IndexedDB. Returns the key used. */
export async function storeAudioBlob(key: string, blob: Blob): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).put(blob, key);
		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => { db.close(); reject(tx.error); };
	});
}

/** Retrieve an audio blob from IndexedDB. Returns null if not found. */
export async function getAudioBlob(key: string): Promise<Blob | null> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const req = tx.objectStore(STORE_NAME).get(key);
		req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
		req.onerror = () => { db.close(); reject(req.error); };
	});
}

/** Delete an audio blob from IndexedDB. */
export async function deleteAudioBlob(key: string): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).delete(key);
		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => { db.close(); reject(tx.error); };
	});
}
