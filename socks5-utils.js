export function parseSocks5ConnectRequest(buffer) {
    if (buffer.length < 7) throw new Error('SOCKS5 request too short');
    const version = buffer[0];
    const cmd = buffer[1];
    const atyp = buffer[3];
    
    if (version !== 0x05) throw new Error('Unsupported SOCKS version');
    if (cmd !== 0x01) throw new Error('Only CONNECT (0x01) is supported');
    
    let offset = 4;
    let host, port;
    
    switch (atyp) {
        case 0x01: // IPv4
            host = `${buffer[offset++]}.${buffer[offset++]}.${buffer[offset++]}.${buffer[offset++]}`;
            port = buffer.readUInt16BE(offset);
            break;
        case 0x03: // Domain
            const domainLength = buffer[offset++];
            host = buffer.toString('utf8', offset, offset + domainLength);
            offset += domainLength;
            port = buffer.readUInt16BE(offset);
            break;
        case 0x04: // IPv6
            const parts = [];
            for (let i = 0; i < 16; i += 2) {
                parts.push(buffer.readUInt16BE(offset + i).toString(16));
            }
            host = parts.join(':').replace(/(^|:)0(:0)*:0?/, '$1::$2');
            offset += 16;
            port = buffer.readUInt16BE(offset);
            break;
        default:
            throw new Error(`Unsupported address type: 0x${atyp.toString(16)}`);
    }
    return { host, port };
}

export function createSocks5Response(status = 0x00) {
    return Buffer.from([0x05, status, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}
