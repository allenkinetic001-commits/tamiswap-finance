const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying TamiSwapFeeRouter with account:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("TamiSwapFeeRouter");
  const router = await Factory.deploy();
  await router.deployed();

  console.log("TamiSwapFeeRouter deployed to:", router.address);
  console.log("Set VITE_FEE_ROUTER_ADDRESS=" + router.address + " in your environment.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
