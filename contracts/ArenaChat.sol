// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract ArenaChat {
    event Message(uint256 indexed roomId, address indexed from, string text);
    function say(uint256 roomId, string calldata text) external {
        uint256 len = bytes(text).length;
        require(len > 0 && len <= 140, "1-140 karakter");
        emit Message(roomId, msg.sender, text);
    }
}
