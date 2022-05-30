const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const one = ethers.utils.parseUnits("1", 36);
describe("Liquidity Bin Pair", function () {
  before(async function () {
    this.signers = await ethers.getSigners();
    this.alice = this.signers[0];

    this.MathS40x36_CF = await ethers.getContractFactory("MathS40x36");
    this.MathS40x36 = await this.MathS40x36_CF.deploy();

    this.LB_CF = await ethers.getContractFactory("LBPair", {
      libraries: { MathS40x36: this.MathS40x36.address },
    });
    this.ERC20MockDecimals_CF = await ethers.getContractFactory(
      "ERC20MockDecimals"
    );
  });

  beforeEach(async function () {
    this.token12D = await this.ERC20MockDecimals_CF.deploy(12);
    this.token6D = await this.ERC20MockDecimals_CF.deploy(6);
    this.LB = await this.LB_CF.deploy(
      this.token6D.address,
      this.token12D.address,
      2
    );
  });

  it("Should verify that 2 opposite ids have an inverse price", async function () {
    expect(
      (await this.LB.getPriceFromId(100))
        .mul(await this.LB.getPriceFromId(-100))
        .div(one)
    ).closeTo(one, one.div(100_000_000));
    expect(
      (await this.LB.getPriceFromId(10_000))
        .mul(await this.LB.getPriceFromId(-10_000))
        .div(one)
    ).closeTo(one, one.div(100_000_000));
    expect(
      (await this.LB.getPriceFromId(100_000))
        .mul(await this.LB.getPriceFromId(-100_000))
        .div(one)
    ).closeTo(one, one.div(100_000_000));
  });

  it("Should add liquidity accordingly", async function () {
    await this.token6D.mint(this.LB.address, ethers.utils.parseUnits("150", 6));
    await this.token12D.mint(
      this.LB.address,
      ethers.utils.parseUnits("150", 12)
    );

    const startId = await this.LB.getIdFromPrice(
      ethers.utils.parseUnits("0.99995", 42)
    );

    // 0.9999,   1.000,   1,001
    // [0, 100], [50, 50], [100, 0]
    await this.LB.mint(
      startId,
      [0, ethers.utils.parseUnits("50", 6), ethers.utils.parseUnits("100", 6)],
      [
        ethers.utils.parseUnits("100", 12),
        ethers.utils.parseUnits("50", 12),
        0,
      ],
      this.alice.address
    );

    const bin0 = await this.LB.getBin(startId);
    const bin1 = await this.LB.getBin(startId + 1);
    const bin2 = await this.LB.getBin(startId + 2);

    expect(bin0.reserve0).to.be.equal(0);
    expect(bin0.reserve1).to.be.equal(ethers.utils.parseUnits("100", 12));

    expect(bin1.reserve0).to.be.equal(ethers.utils.parseUnits("50", 6));
    expect(bin1.reserve1).to.be.equal(ethers.utils.parseUnits("50", 12));

    expect(bin2.reserve0).to.be.equal(ethers.utils.parseUnits("100", 6));
    expect(bin2.reserve1).to.be.equal(0);

    expect(bin1.price).to.be.above(bin0.price);
    expect(bin2.price).to.be.above(bin1.price);
  });

  it("Should swap in only 1 bin 1.003.. token1 for 1 token0 at price 1 (0.3% fee)", async function () {
    const tokenAmount = ethers.utils.parseUnits("100", 6);
    await this.token6D.mint(this.LB.address, tokenAmount);

    const id = 100_000;

    //  1.0000
    // [100, 0]
    await this.LB.mint(id, [tokenAmount], [0], this.alice.address);

    const amount0Out = ethers.utils.parseUnits("1", 6);
    const amount1In = (await this.LB.getSwapIn(amount0Out, 0)).amount1In;

    await this.token12D.mint(this.LB.address, amount1In);
    await this.LB.connect(this.alice).swap(
      amount0Out,
      0,
      this.alice.address,
      0
    );

    expect(await this.token6D.balanceOf(this.alice.address)).to.be.equal(
      amount0Out
    );
    expect(await this.token12D.balanceOf(this.alice.address)).to.be.equal(0);

    const bin = await this.LB.getBin(id);

    expect(bin.reserve0).to.be.equal(tokenAmount.sub(amount0Out));
    expect(bin.reserve1).to.be.equal(amount1In);
  });

  it("Should swap in only 1 bin 1.002908 token0 for 1 token1 at price 1.0001 (0.3% fee)", async function () {
    const tokenAmount = ethers.utils.parseUnits("100", 12);
    await this.token12D.mint(this.LB.address, tokenAmount);

    const id = 100_000;

    // [100, 0], [0, 100]
    await this.LB.mint(id, [0], [tokenAmount], this.alice.address);

    const amount0In = ethers.utils.parseUnits("1", 6);
    const amount1Out = (await this.LB.getSwapOut(amount0In, 0)).amount1Out;

    await this.token6D.mint(this.LB.address, amount0In);
    await this.LB.connect(this.alice).swap(
      0,
      amount1Out,
      this.alice.address,
      0
    );

    expect(await this.token6D.balanceOf(this.alice.address)).to.be.equal(0);
    expect(await this.token12D.balanceOf(this.alice.address)).to.be.equal(
      amount1Out
    );

    const bin = await this.LB.getBin(id);

    expect(bin.reserve0).to.be.equal(amount0In);
    expect(bin.reserve1).to.be.equal(tokenAmount.sub(amount1Out));
  });

  it("Should add liquidity and swap, in multiple bins, token0 for 100 token1 at market price (0.3% fee)", async function () {
    const tokenAmount = ethers.utils.parseUnits("100", 12);
    await this.token12D.mint(this.LB.address, tokenAmount);

    const startId = 200_000;

    const nb = 10;
    let bins0 = Array(nb).fill(0);
    let bins1 = Array(nb).fill(tokenAmount.div(nb));

    await this.LB.mint(startId, bins0, bins1, this.alice.address);

    const amount1Out = tokenAmount;
    const amount0In = (await this.LB.getSwapIn(0, amount1Out)).amount0In;

    await this.token6D.mint(this.LB.address, amount0In);

    await this.LB.connect(this.alice).swap(
      0,
      amount1Out,
      this.alice.address,
      0
    );

    expect(await this.token6D.balanceOf(this.alice.address)).to.be.equal(0);
    expect(await this.token12D.balanceOf(this.alice.address)).to.be.equal(
      amount1Out
    );

    const global = await this.LB.global();
    expect(global.reserve0).to.be.equal(amount0In);
    expect(global.reserve1).to.be.equal(0);
  });

  it("Should add liquidity and swap, in multiple bins, 10 token1 for token0 at market price (0.3% fee)", async function () {
    const tokenAmount = ethers.utils.parseUnits("100", 6);
    await this.token6D.mint(this.LB.address, tokenAmount);

    const startId = 123456;

    const nb = 10;
    let bins0 = Array(nb).fill(tokenAmount.div(nb));
    let bins1 = Array(nb).fill(0);

    await this.LB.mint(startId, bins0, bins1, this.alice.address);

    const amount1In = ethers.utils.parseUnits("10", 12);
    const amount0Out = (await this.LB.getSwapOut(0, amount1In)).amount0Out;

    await this.token12D.mint(this.LB.address, amount1In);

    await this.LB.connect(this.alice).swap(
      amount0Out,
      0,
      this.alice.address,
      0
    );

    expect(await this.token6D.balanceOf(this.alice.address)).to.be.equal(
      amount0Out
    );
    expect(await this.token12D.balanceOf(this.alice.address)).to.be.equal(0);

    const global = await this.LB.global();
    expect(global.reserve0).to.be.equal(tokenAmount.sub(amount0Out));
    expect(global.reserve1).to.be.closeTo(amount1In, amount1In.div(10_000));
  });

  it("Should add liquidity and swap token0 for token1, even if the 2 bins are really far away", async function () {
    const tokenAmount = ethers.utils.parseUnits("100", 12);
    await this.token12D.mint(this.LB.address, tokenAmount);

    // await this.LB.mint(10_000, [0], [tokenAmount.div(2)], this.alice.address);

    await this.LB.mint(-10_000, [0], [tokenAmount.div(2)], this.alice.address);

    await this.token6D.mint(this.LB.address, ethers.utils.parseUnits("1", 75));
    // await this.LB.connect(this.alice).swap(
    //   0,
    //   tokenAmount,
    //   this.alice.address,
    //   0
    // );

    // expect(await this.token6D.balanceOf(this.alice.address)).to.be.equal(0);
    // expect(await this.token12D.balanceOf(this.alice.address)).to.be.equal(
    //   tokenAmount
    // );

    // const global = await this.LB.global();
    // expect(global.reserve0).to.be.above(0);
    // expect(global.reserve1).to.be.equal(0);
  });

  it("Should add liquidity and swap token1 for token0, even if the 2 bins are really far away", async function () {
    const tokenAmount = ethers.utils.parseUnits("100", 6);
    await this.token6D.mint(this.LB.address, tokenAmount);

    await this.LB.mint(-10_000, [tokenAmount.div(2)], [0], this.alice.address);

    await this.LB.mint(10_000, [tokenAmount.div(2)], [0], this.alice.address);

    await this.token12D.mint(this.LB.address, ethers.utils.parseUnits("1", 75));
    await this.LB.connect(this.alice).swap(
      tokenAmount,
      0,
      this.alice.address,
      0
    );

    expect(await this.token6D.balanceOf(this.alice.address)).to.be.equal(
      tokenAmount
    );
    expect(await this.token12D.balanceOf(this.alice.address)).to.be.equal(0);

    const global = await this.LB.global();
    expect(global.reserve0).to.be.equal(0);
    expect(global.reserve1).to.be.above(0);
  });

  it("20M swap with 36M liq", async function () {
    //  6D = x
    // 12D = y
    const tokenAmount = ethers.utils.parseUnits("360000", 12);
    await this.token12D.mint(this.LB.address, tokenAmount);

    const nb = 100;
    let bins0 = [];
    let bins1 = [];

    for (let i = 0; i < nb; i++) {
      bins0 = bins0.concat(0);
      bins1 = bins1.concat(tokenAmount.div(nb));
    }

    const startId = await this.LB.getIdFromPrice(
      ethers.utils.parseUnits("0.99954", 42)
    );

    await this.LB.mint(0, bins0, bins1, this.alice.address);

    const amount0In = ethers.utils.parseUnits("1", 6);
    const amount1Out = (await this.LB.getSwapOut(amount0In, 0)).amount1Out;

    const startPrice = (
      await this.LB.getPriceFromId((await this.LB.global()).currentId)
    ).div(one.div(100));

    await this.token6D.mint(this.LB.address, amount0In);
    await this.LB.connect(this.alice).swap(
      0,
      amount1Out,
      this.alice.address,
      0
    );

    console.log(
      amount0In.toString() / 1e6,
      "token 1 ->",
      (await this.token12D.balanceOf(this.alice.address)).toString() / 1e12,
      "token0"
    );

    const endPrice = (
      await this.LB.getPriceFromId((await this.LB.global()).currentId)
    ).div(one.div(100));
    console.log(
      "Price impact:",
      (Math.abs(endPrice - startPrice) / startPrice) * 100,
      "%"
    );
  });

  it("Should add and remove liquidity accordingly", async function () {
    await this.token6D.mint(this.LB.address, ethers.utils.parseUnits("150", 6));
    await this.token12D.mint(
      this.LB.address,
      ethers.utils.parseUnits("150", 12)
    );

    const startId = await this.LB.getIdFromPrice(
      ethers.utils.parseUnits("1", 42)
    );

    // 0.9999,   1.000,   1,001
    // [0, 100], [50, 50], [100, 0]
    await this.LB.mint(
      startId,
      [0, ethers.utils.parseUnits("50", 6), ethers.utils.parseUnits("100", 6)],
      [
        ethers.utils.parseUnits("100", 12),
        ethers.utils.parseUnits("50", 12),
        0,
      ],
      this.alice.address
    );

    await this.LB.connect(this.alice).safeTransfer(
      this.LB.address,
      startId,
      await this.LB.balanceOf(this.alice.address, startId)
    );
    await this.LB.connect(this.alice).safeTransfer(
      this.LB.address,
      startId + 1,
      await this.LB.balanceOf(this.alice.address, startId + 1)
    );
    await this.LB.connect(this.alice).safeTransfer(
      this.LB.address,
      startId + 2,
      await this.LB.balanceOf(this.alice.address, startId + 2)
    );

    await this.LB.burn([startId, startId + 1, startId + 2], this.alice.address);

    const bin0 = await this.LB.getBin(startId);
    const bin1 = await this.LB.getBin(startId + 1);
    const bin2 = await this.LB.getBin(startId + 2);

    expect(bin0.reserve0).to.be.equal(0);
    expect(bin0.reserve1).to.be.equal("1000");

    expect(bin1.reserve0).to.be.equal("1");
    expect(bin1.reserve1).to.be.equal("500"); // @audit was 501... wtf

    expect(bin2.reserve0).to.be.equal("1");
    expect(bin2.reserve1).to.be.equal(0);

    expect(bin1.price).to.be.above(bin0.price);
    expect(bin2.price).to.be.above(bin1.price);
  });

  // TODO add liquidity when fill factor is not 0
  // TODO investigate price limit ()

  after(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});