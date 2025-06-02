// Polyfill Buffer if in an environment that needs it and provides a global 'Buffer' object (e.g. Node.js compat mode in CF workers)
// For simplicity, this code assumes 'Buffer' is available globally when these functions are called.
// Proper Buffer polyfilling for browsers or strict CF Worker environments might need a dedicated polyfill.

export function parseSocks5ConnectRequest(buffer) {
    if (!(buffer instanceof Buffer)) {
        throw new Error('Input must be a Buffer.');
    }
    if (buffer.length < 7) throw new Error('SOCKS5 request too short');
    const version = buffer[0];
    const cmd = buffer[1];
    // Skip RSV buffer[2]
    const atyp = buffer[3];

    if (version !== 0x05) throw new Error('Unsupported SOCKS version');
    if (cmd !== 0x01) throw new Error('Only CONNECT (0x01) is supported');

    let offset = 4;
    let host;
    let port;

    switch (atyp) {
        case 0x01: // IPv4
            if (buffer.length < offset + 4 + 2) throw new Error('Invalid IPv4 address length in SOCKS5 request'); // 4 for IP, 2 for port
            host = `${buffer[offset++]}.${buffer[offset++]}.${buffer[offset++]}.${buffer[offset++]}`;
            port = buffer.readUInt16BE(offset);
            offset += 2;
            break;
        case 0x03: // Domain
            if (buffer.length < offset + 1) throw new Error('Invalid domain length header in SOCKS5 request');
            const domainLength = buffer[offset++];
            if (buffer.length < offset + domainLength + 2) throw new Error('Invalid domain length in SOCKS5 request'); // domainLength for domain, 2 for port
            host = buffer.toString('utf8', offset, offset + domainLength);
            offset += domainLength;
            port = buffer.readUInt16BE(offset);
            offset += 2;
            break;
        case 0x04: // IPv6
            if (buffer.length < offset + 16 + 2) throw new Error('Invalid IPv6 address length in SOCKS5 request'); // 16 for IP, 2 for port
            const parts = [];
            for (let i = 0; i < 16; i += 2) {
                parts.push(buffer.readUInt16BE(offset + i).toString(16));
            }
            host = parts.join(':').replace(/(^|:)0+(:0+)*:0+/, '$1::$2'); // Basic IPv6 canonicalization
            offset += 16;
            port = buffer.readUInt16BE(offset);
            offset += 2;
            break;
        default:
            throw new Error(`Unsupported address type: 0x${atyp.toString(16)}`);
    }

    if (port < 1 || port > 65535) {
        throw new Error('Invalid port number');
    }

    return { host, port, atyp, rawHost: buffer.slice(4, offset -2), rawPort: buffer.slice(offset-2, offset) };
}

export function createSocks5Response(status = 0x00, host = '0.0.0.0', port = 0, atyp = 0x01) {
    // SOCKS5 response format:
    // +----+-----+-------+------+----------+----------+
    // |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
    // +----+-----+-------+------+----------+----------+
    // | 1  |  1  | X'00' |  1   | Variable |    2     |
    // +----+-----+-------+------+----------+----------+

    let bndAddrBuffer;
    let finalAtyp = atyp;

    if (atyp === 0x01) { // IPv4
        const parts = host.split('.');
        if (parts.length === 4) {
            bndAddrBuffer = Buffer.alloc(4);
            bndAddrBuffer[0] = parseInt(parts[0], 10) || 0;
            bndAddrBuffer[1] = parseInt(parts[1], 10) || 0;
            bndAddrBuffer[2] = parseInt(parts[2], 10) || 0;
            bndAddrBuffer[3] = parseInt(parts[3], 10) || 0;
        } else { // Default to 0.0.0.0 if invalid IPv4 string
            bndAddrBuffer = Buffer.from([0,0,0,0]);
        }
    } else if (atyp === 0x03) { // Domain name
        const domainBuffer = Buffer.from(host, 'utf8');
        if (domainBuffer.length > 255) {
            throw new Error("Domain name too long for SOCKS5 response");
        }
        bndAddrBuffer = Buffer.concat([Buffer.from([domainBuffer.length]), domainBuffer]);
    } else if (atyp === 0x04) { // IPv6
         // Simplified: assumes host is a valid IPv6 string that can be parsed into 16 bytes
        const parts = host.split(':').flatMap(part => {
            if (part === "") return part === host.split('::')[0] ? [] : ['0000']; // handle '::'
            return part.length < 4 ? '0'.repeat(4 - part.length) + part : part;
        });
        const processedParts = [];
        let doubleColonFound = false;
        for(const part of host.split(':')) {
            if (part === "" && !doubleColonFound) {
                // This logic is a bit flawed for all IPv6 cases, e.g. "::1" vs "1::"
                // A robust IPv6 parser is complex. This is a simplification.
                // Count existing parts and fill the rest with '0000' for '::'
                const existingParts = host.split(':').filter(p => p !== "").length;
                const partsToFill = 8 - existingParts;
                for(let i=0; i<partsToFill; i++) {
                    processedParts.push('0000');
                }
                doubleColonFound = true;
            } else if (part !== "") {
                 processedParts.push(part.padStart(4, '0'));
            }
        }

        // If after processing, we don't have 8 parts, the IPv6 was likely complex or malformed for this simple parser
        if (processedParts.length > 8 && host.includes("::")) { // check if :: caused overfill
             // attempt to correct overfill from '::' logic
            const partsToFill = host.split(':').filter(p => p !== "").length;
            const expectedZeros = 8 - partsToFill;
            let zeroCount = processedParts.filter(p => p === '0000').length;
            while(zeroCount > expectedZeros && processedParts.includes('0000')) {
                processedParts.splice(processedParts.indexOf('0000'), 1);
                zeroCount--;
            }
        }


        bndAddrBuffer = Buffer.alloc(16);
        let bIndex = 0;
        if(processedParts.length === 8) {
            for (const part of processedParts) {
                if (part.length > 4) { // Should not happen with padStart(4,'0')
                     finalAtyp = 0x01; bndAddrBuffer = Buffer.from([0,0,0,0]); break;
                }
                bndAddrBuffer.writeUInt16BE(parseInt(part, 16), bIndex);
                bIndex += 2;
            }
        } else { // Default to :: (unspecified) if IPv6 string is complex or invalid for this parser
             finalAtyp = 0x01; // Fallback to IPv4 0.0.0.0 for safety
             bndAddrBuffer = Buffer.from([0,0,0,0]);
        }
    } else { // Default to IPv4 0.0.0.0 for unknown atyp
        finalAtyp = 0x01;
        bndAddrBuffer = Buffer.from([0,0,0,0]);
    }

    const headerBuffer = Buffer.from([
        0x05,   // VER: SOCKS version 5
        status, // REP: Reply field
        0x00,   // RSV: Reserved
        finalAtyp    // ATYP: Address type
    ]);

    const portBuffer = Buffer.alloc(2);
    portBuffer.writeUInt16BE(port & 0xFFFF, 0);

    return Buffer.concat([headerBuffer, bndAddrBuffer, portBuffer]);
}

// SOCKS5 status codes
export const SOCKS5_STATUS = {
    SUCCESS: 0x00,
    GENERAL_FAILURE: 0x01,
    CONNECTION_NOT_ALLOWED: 0x02,
    NETWORK_UNREACHABLE: 0x03,
    HOST_UNREACHABLE: 0x04,
    CONNECTION_REFUSED: 0x05,
    TTL_EXPIRED: 0x06,
    COMMAND_NOT_SUPPORTED: 0x07,
    ADDRESS_TYPE_NOT_SUPPORTED: 0x08,
    // Adding custom or less common ones if needed
    UNASSIGNED: 0x09 // up to 0xFF
};
