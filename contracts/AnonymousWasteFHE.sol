// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AnonymousWasteFHE is SepoliaConfig {
    struct EncryptedBinData {
        uint256 id;
        euint32 encryptedBinLevel; // Encrypted bin fill level
        euint32 encryptedWasteType; // Encrypted waste type category
        uint256 timestamp;
    }

    struct DecryptedBinData {
        string binLevel;
        string wasteType;
        bool isDecrypted;
    }

    uint256 public binDataCount;
    mapping(uint256 => EncryptedBinData) public encryptedBins;
    mapping(uint256 => DecryptedBinData) public decryptedBins;

    mapping(string => euint32) private encryptedTypeCount;
    string[] private wasteTypes;

    mapping(uint256 => uint256) private decryptionRequests;

    event BinDataSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event BinDataDecrypted(uint256 indexed id);

    modifier onlyUploader(uint256 binId) {
        // Placeholder for access control
        _;
    }

    /// @notice Submit encrypted bin data
    function submitEncryptedBinData(
        euint32 encryptedBinLevel,
        euint32 encryptedWasteType
    ) public {
        binDataCount += 1;
        uint256 newId = binDataCount;

        encryptedBins[newId] = EncryptedBinData({
            id: newId,
            encryptedBinLevel: encryptedBinLevel,
            encryptedWasteType: encryptedWasteType,
            timestamp: block.timestamp
        });

        decryptedBins[newId] = DecryptedBinData({
            binLevel: "",
            wasteType: "",
            isDecrypted: false
        });

        emit BinDataSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of bin data
    function requestBinDecryption(uint256 binId) public onlyUploader(binId) {
        EncryptedBinData storage bin = encryptedBins[binId];
        require(!decryptedBins[binId].isDecrypted, "Already decrypted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(bin.encryptedBinLevel);
        ciphertexts[1] = FHE.toBytes32(bin.encryptedWasteType);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptBinData.selector);
        decryptionRequests[reqId] = binId;

        emit DecryptionRequested(binId);
    }

    /// @notice Callback for decrypted bin data
    function decryptBinData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 binId = decryptionRequests[requestId];
        require(binId != 0, "Invalid request");

        EncryptedBinData storage eBin = encryptedBins[binId];
        DecryptedBinData storage dBin = decryptedBins[binId];
        require(!dBin.isDecrypted, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));
        dBin.binLevel = results[0];
        dBin.wasteType = results[1];
        dBin.isDecrypted = true;

        if (FHE.isInitialized(encryptedTypeCount[dBin.wasteType]) == false) {
            encryptedTypeCount[dBin.wasteType] = FHE.asEuint32(0);
            wasteTypes.push(dBin.wasteType);
        }
        encryptedTypeCount[dBin.wasteType] = FHE.add(
            encryptedTypeCount[dBin.wasteType],
            FHE.asEuint32(1)
        );

        emit BinDataDecrypted(binId);
    }

    /// @notice Get decrypted bin data
    function getDecryptedBinData(uint256 binId) public view returns (
        string memory binLevel,
        string memory wasteType,
        bool isDecrypted
    ) {
        DecryptedBinData storage d = decryptedBins[binId];
        return (d.binLevel, d.wasteType, d.isDecrypted);
    }

    /// @notice Get encrypted type count
    function getEncryptedTypeCount(string memory wasteType) public view returns (euint32) {
        return encryptedTypeCount[wasteType];
    }

    /// @notice Request type count decryption
    function requestTypeCountDecryption(string memory wasteType) public {
        euint32 count = encryptedTypeCount[wasteType];
        require(FHE.isInitialized(count), "Waste type not found");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptTypeCount.selector);
        decryptionRequests[reqId] = bytes32ToUint(keccak256(abi.encodePacked(wasteType)));
    }

    /// @notice Callback for decrypted type count
    function decryptTypeCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 typeHash = decryptionRequests[requestId];
        string memory wasteType = getTypeFromHash(typeHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
        // Decrypted count can be used for analytics or routing optimization
    }

    // Helper functions
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getTypeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < wasteTypes.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(wasteTypes[i]))) == hash) {
                return wasteTypes[i];
            }
        }
        revert("Waste type not found");
    }
}
